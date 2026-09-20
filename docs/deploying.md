# Deploying evo.polaris

The app is static files. It is served at `polaris.evomedia.net` out of the
landing container's `<per-host directory>`, proxied by evo.edge — the same shape as
`zscripts.evomedia.net` and the AbleCamera product site.

## HTTPS is a hard requirement, not a nicety

Three things this app depends on are **secure-context APIs**, and all three fail
on plain `http://`:

| API | What breaks without TLS |
| --- | --- |
| Geolocation | "Use my location" does nothing at all |
| DeviceOrientation | the live compass arrows never appear |
| Service worker | no offline support, which is the normal case in a field |

They fail **silently** — no console error a casual look would catch, no message
to the user. A phone visiting this host is supposed to get its position and its
heading from the browser with no typing whatsoever, and that only happens over
TLS. `localhost` is exempt from the rule, which is exactly why `npm run serve`
works and hides the problem during development.

## The two-phase certificate dance

A vhost and its certificate cannot arrive together. nginx refuses to start when
`ssl_certificate` names a file that is not there, and the certificate cannot be
issued until the name already answers the ACME challenge. So:

**Phase one** — the `:80` block alone, serving `/.well-known/acme-challenge/`
from `/var/www/acme` and redirecting everything else. Merged in
[evo.edge#122](https://github.com/evomedia-net/evo.edge/pull/122). Deploy the
edge before going further, or the challenge is answered by the `:80` default
server, which proxies unmatched hosts to evo.ehs and hands Let's Encrypt a 404.

**Issue the certificate**, on the box. Renewal uses the account already
registered in the shared certbot volumes, so no `-m` is needed:

```bash
docker run --rm \
  -v <certbot-conf>:/etc/letsencrypt \
  -v <certbot-www>:/var/www/acme \
  certbot/certbot certonly --webroot -w /var/www/acme \
  -d polaris.evomedia.net --non-interactive --agree-tos
```

Renewal is automatic afterwards: hostops runs `certbot renew` nightly at 02:00
across everything in `/etc/letsencrypt`, so a new certificate is picked up
without further work. Add the name to the managed list in the hostops README so
the inventory stays true.

**Phase two** — the `:443` block, once the certificate exists. Then deploy the
edge again.

## The whitelist trap

The landing vhosts do not serve arbitrary paths. Each has a location whose
regex lists the file extensions it answers for, and everything else falls
through to `return 444` — the connection closed with no response at all.

**This host needs `.json`, and no other landing host does.** evo.polaris ships
its 9,096-star catalogue as `site/src/data/stars.json`. Copying a neighbouring
host's list — the natural move, and the ablecamera list does not include
`json` — leaves the catalogue sitting on disk at the right path with the right
bytes while every request for it closes mid-connection. In a browser that is an
empty sky chart. In curl it reads as `server closed abruptly (missing
close_notify)`, which looks like a TLS or network fault, and an extension list
in `nginx.conf` is the last place anyone thinks to look.

The full set this app needs:

```
html | css | js | json | svg | webmanifest
```

`evo.edge`'s `tests/test_landing_asset_whitelist.py` exists to enforce exactly
this mapping. Polaris belongs in its `EXPECTED` map so the requirement is
checked rather than remembered — added with the phase-two block, because that
file's `test_the_tls_block_is_the_one_that_matters` requires a TLS block to
exist.

## Deploying the app itself

The `zdeploy` target is `polaris`, registered in `scripts/zconfig.json`:

```
kind      static
localRoot <checkout>
siteDir   site
domain    polaris.evomedia.net
remote    <web-root>
```

`siteDir` is `site` rather than the repository root **on purpose**. zdeploy
copies that directory to a public web root, and the repository holds test
fixtures, build scripts and `package.json` that have no business being
published — particularly while the repo itself is private. zdeploy does support
a per-project `deploy.exclude` list, but an exclude list fails *open*: forget an
entry and it ships. A `siteDir` fails *closed*: forget a file and it is merely
missing, which is obvious on the first page load.

The local checkout must be on `main` before deploying. zdeploy pulls from it,
and a checkout left on a feature branch is a known way to make the deploy fail.

## Order

1. Merge the edge phase-one vhost. *(done — evo.edge#122)*
2. `zdeploy edge` — the name now answers on `:80`.
3. `zdeploy polaris` — content lands, so there is something there when TLS goes up.
4. Issue the certificate with the command above.
5. Merge the edge phase-two vhost, including the `json` whitelist.
6. `zdeploy edge` — TLS live.

An unmerged vhost is clobbered by any edge deploy from `main`, because the edge
ships one monolithic `nginx.conf`. The tell is a wrong TLS certificate being
served for the name. So each edge change is merged before the deploy that is
meant to carry it, never after.

## Verifying it actually landed

Merged is not deployed, and deployed is not working. Check the running service,
not the deploy script's exit code:

```bash
curl -sI https://polaris.evomedia.net | head -3
curl -s https://polaris.evomedia.net/src/data/stars.json | head -c 60
```

The second one is the real test: it is the request the whitelist would refuse.
A `444`/empty response there means `json` is missing from the extension list,
and the app will load with an empty sky chart.

## Cache busting on release

The service worker is **network-first for the app shell** and cache-first only
for the star and magnetic data. Cache-first for everything is how a static site
pins every returning visitor to the first build they ever loaded, so a deploy
would reach nobody until they cleared site data.

Bump `VERSION` in `site/sw.js` with each release. Old caches are dropped on
activate, keyed by that string.
