// THE FIFTEEN BRIGHTEST GALAXIES, FROM SIMBAD.
//
// Every number here came from one SIMBAD TAP query on 2026-09-25, and that
// query and its answer are committed at test/fixtures/simbad-galaxies.txt.
// test/galaxies.test.mjs parses the fixture and compares it to this file
// field by field, so a coordinate typed wrong is a test failure rather than
// an arrow pointing at empty sky. That is the same arrangement the magnetic
// model has with NOAA's test vectors: nothing here is validated against
// itself.
//
// `ra` and `dec` are J2000 degrees and are precessed to the date exactly as
// the star catalogue is. `mag` is integrated V. `maj` and `min` are the major
// and minor axes in ARCMINUTES, which is what lets each one be drawn at its
// true size -- the Andromeda Galaxy really is three degrees across, six times
// the width of the Moon, and an app that draws it as a dot is hiding the one
// fact that decides whether it fits your frame.
//
// `angle` is the position angle of the major axis in degrees east of north,
// which SIMBAD does not carry for all of these; where it is null the ellipse
// is drawn unrotated and the app says nothing it does not know.
//
// SIX BRIGHTER OBJECTS ARE DELIBERATELY NOT HERE, and the fixture names each
// one with its reason. The short version: four are Milky Way dwarf
// spheroidals whose integrated magnitude is bright only because they are
// enormous, spread so thin that nobody sees them as a galaxy; one has a
// magnitude that does not fit its size; one has no dimensions at all. The
// Magellanic Clouds are also enormous and also nearby and DO stay, because
// they are plainly visible to the naked eye.
//
// The common names are editorial -- SIMBAD's identifier is "M 31" and the
// person holding the phone calls it Andromeda.

export const GALAXIES = [
  { key: 'lmc', id: 'LMC', name: 'Large Magellanic Cloud',
    ra: 80.89416666666666, dec: -69.75611111111111, mag: 0.4, maj: 322.82666, min: 274.77 },
  { key: 'smc', id: 'SMC', name: 'Small Magellanic Cloud',
    ra: 13.158333333333333, dec: -72.80027777777778, mag: 2.2, maj: 158.11333, min: 93.105 },
  { key: 'm31', id: 'M 31', name: 'Andromeda Galaxy',
    ra: 10.684708333333333, dec: 41.268750000000004, mag: 3.44, maj: 199.53, min: 70.79 },
  { key: 'm33', id: 'M 33', name: 'Triangulum Galaxy',
    ra: 23.46206906218, dec: 30.660175111980003, mag: 5.72, maj: 60.26, min: 35.48 },
  { key: 'cena', id: 'NGC 5128', name: 'Centaurus A',
    ra: 201.36506337683332, dec: -43.019112508083325, mag: 6.84, maj: 25.7, min: 17.78 },
  { key: 'm81', id: 'M 81', name: "Bode's Galaxy",
    ra: 148.88821939854, dec: 69.06529514038, mag: 6.94, maj: 21.38, min: 10.23 },
  { key: 'm83', id: 'M 83', name: 'Southern Pinwheel',
    ra: 204.25383, dec: -29.865761111111112, mag: 7.52, maj: 13.8, min: 12.88 },
  { key: 'm101', id: 'M 101', name: 'Pinwheel Galaxy',
    ra: 210.80242916666668, dec: 54.34875, mag: 7.86, maj: 21.88, min: 20.89 },
  { key: 'ngc55', id: 'NGC 55', name: 'NGC 55',
    ra: 3.7233416666666663, dec: -39.19662777777777, mag: 7.87, maj: 32.36, min: 3.98 },
  { key: 'm104', id: 'M 104', name: 'Sombrero Galaxy',
    ra: 189.99763274591663, dec: -11.623054494444448, mag: 8.0, maj: 8.51, min: 5.01 },
  { key: 'm110', id: 'M 110', name: 'M 110',
    ra: 10.09190514583, dec: 41.68541867226, mag: 8.07, maj: 3.332, min: 2.0991666 },
  { key: 'm32', id: 'M 32', name: 'M 32',
    ra: 10.67427, dec: 40.86517, mag: 8.08, maj: 3.375, min: 2.73375 },
  { key: 'ngc6822', id: 'NGC 6822', name: "Barnard's Galaxy",
    ra: 296.2341625, dec: -14.797580555555559, mag: 8.1, maj: 13.8, min: 12.88 },
  { key: 'ngc300', id: 'NGC 300', name: 'NGC 300',
    ra: 13.722694015959998, dec: -37.68421344511, mag: 8.13, maj: 20.89, min: 13.49 },
  { key: 'm94', id: 'M 94', name: 'M 94',
    ra: 192.72114082143, dec: 41.12025024573, mag: 8.24, maj: 6.99078, min: 5.86107 },
];

/** The walk's stops, in the order the button visits them: brightest first. */
export const GALAXY_KEYS = GALAXIES.map((g) => g.key);

/** One galaxy by key, or undefined. */
export function galaxyFor(key) {
  return GALAXIES.find((g) => g.key === key);
}
