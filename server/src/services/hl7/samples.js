'use strict';

/**
 * Sample OMP^O09 messages used by the demo endpoint and the test suite.
 *
 * Segments are assembled from a sparse {fieldIndex: value} map rather than
 * typed out as pipe-delimited strings, so a field can never silently land in
 * the wrong position while editing.
 */

function segment(name, fields) {
  const indices = Object.keys(fields).map(Number);
  const highest = indices.length ? Math.max(...indices) : 0;
  const parts = [name];
  for (let i = 1; i <= highest; i += 1) {
    const value = fields[i];
    parts.push(value === undefined || value === null ? '' : String(value));
  }
  return parts.join('|');
}

/** MSH is special: MSH-1 is the field separator and MSH-2 the encoding chars. */
function msh(fields) {
  const indices = Object.keys(fields).map(Number);
  const highest = indices.length ? Math.max(...indices) : 2;
  const parts = ['MSH', '^~\\&'];
  for (let i = 3; i <= highest; i += 1) {
    const value = fields[i];
    parts.push(value === undefined || value === null ? '' : String(value));
  }
  return parts.join('|');
}

function build(segments) {
  return segments.filter(Boolean).join('\r');
}

const STAMP = '20260916101500';

function ompO09({
  controlId = 'MSG00012',
  indentId = 'IND-2026-0091',
  fillerId = 'PH-2026-0091',
  mrn = 'MRN0012345',
  family = 'Rahman',
  given = 'Ayesha',
  middle = 'Binte',
  birthDate = '19780412',
  sex = 'F',
  phone = '+8801711000001',
  ward = 'IPD-7B',
  room = '712',
  bed = 'A',
  visitNumber = 'VN0098',
  rxcui = '311041',
  drugName = 'Insulin Glargine 100 UNT/ML Injectable Solution',
  doseValue = 18,
  doseUnit = '[iU]',
  doseUnitText = 'International Unit',
  doseForm = 'SOLN',
  doseFormText = 'Injectable Solution',
  routeCode = 'SC',
  routeText = 'Subcutaneous',
  dispenseQty = 1,
  orderingProvider = 'PHY4410^Chowdhury^Imran',
  enteredBy = 'NUR9931^Hasan^Mim',
  interval = 'Q24H',
  startAt = '20260916180000',
  priority = 'R',
  notes = ['COLD CHAIN 2-8 C. DO NOT FREEZE. RETURN TO PHARMACY IF SEAL BROKEN.'],
  fridgeTempC = '4.6',
  messageType = 'OMP^O09',
  includeOrc = true,
  includeRxo = true,
} = {}) {
  return build([
    msh({
      3: 'PHARMSYS', 4: 'MAINPHARM', 5: 'COLDCHAIN', 6: ward,
      7: STAMP, 9: messageType, 10: controlId, 11: 'P', 12: '2.5.1',
    }),
    segment('PID', {
      1: '1',
      3: `${mrn}^^^HOSP^MR`,
      5: `${family}^${given}^${middle}`,
      7: birthDate,
      8: sex,
      11: '12 Gulshan Avenue^^Dhaka^^1212^BD',
      13: phone,
    }),
    segment('PV1', {
      1: '1',
      2: 'I',
      3: `${ward}^${room}^${bed}^HOSP`,
      7: orderingProvider,
      19: visitNumber,
    }),
    includeOrc
      ? segment('ORC', {
        1: 'NW',
        2: indentId,
        3: fillerId,
        5: 'IP',
        7: `^${interval}^^${startAt}^^${priority}`,
        9: STAMP,
        10: enteredBy,
        12: orderingProvider,
      })
      : null,
    includeRxo
      ? segment('RXO', {
        1: `${rxcui}^${drugName}^RXNORM`,
        2: doseValue,
        3: doseValue,
        4: `${doseUnit}^${doseUnitText}^UCUM`,
        5: `${doseForm}^${doseFormText}^HL70162`,
        9: 'N',
        10: `${rxcui}^${drugName}^RXNORM`,
        11: dispenseQty,
        12: 'VIAL^vial^HL70560',
        13: '0',
      })
      : null,
    segment('RXR', { 1: `${routeCode}^${routeText}^HL70162` }),
    segment('OBX', {
      1: '1',
      2: 'NM',
      3: '8329-5^Body temperature of storage unit^LN',
      5: fridgeTempC,
      6: 'Cel^degree Celsius^UCUM',
      11: 'F',
      14: STAMP,
    }),
    ...notes.map((text, index) => segment('NTE', { 1: String(index + 1), 2: 'L', 3: text })),
  ]);
}

const samples = {
  /** Happy path: matches MedicationRequest MR-9001 exactly. */
  valid: () => ompO09(),

  /** Same molecule, wrong strength — the safety gate must block this. */
  wrongStrength: () => ompO09({
    controlId: 'MSG00013',
    indentId: 'IND-2026-0092',
    rxcui: '1605101',
    drugName: 'Insulin Glargine 300 UNT/ML Injectable Solution',
    doseValue: 18,
  }),

  /** A drug with a completely different active ingredient to the order. */
  wrongDrug: () => ompO09({
    controlId: 'MSG00014',
    indentId: 'IND-2026-0093',
    mrn: 'MRN0012347',
    family: 'Barua',
    given: 'Mitu',
    middle: '',
    birthDate: '19920220',
    phone: '+8801711000003',
    ward: 'IPD-9A',
    room: '903',
    bed: 'B',
    visitNumber: 'VN0100',
    rxcui: '1670007',
    drugName: 'Insulin Aspart 100 UNT/ML Injectable Solution',
  }),

  /** Arrived warm: the transport probe reported an out-of-range temperature. */
  temperatureExcursion: () => ompO09({
    controlId: 'MSG00015',
    indentId: 'IND-2026-0094',
    mrn: 'MRN0012346',
    family: 'Hossain',
    given: 'Tanvir',
    middle: '',
    birthDate: '19651103',
    sex: 'M',
    phone: '+8801711000002',
    room: '714',
    bed: 'C',
    visitNumber: 'VN0099',
    rxcui: '727578',
    drugName: 'Filgrastim 300 MCG/0.5ML Injection',
    doseValue: 300,
    doseUnit: 'ug',
    doseUnitText: 'microgram',
    doseForm: 'INJ',
    doseFormText: 'Injection',
    fridgeTempC: '11.4',
    notes: ['COLD CHAIN 2-8 C. PROBE ALARM RAISED IN TRANSIT.'],
  }),

  /** Wrong message type — should be rejected before any clinical logic runs. */
  wrongMessageType: () => ompO09({ controlId: 'MSG00016', messageType: 'ADT^A01' }),

  /** Structurally broken: no ORC segment. */
  missingOrc: () => ompO09({ controlId: 'MSG00017', includeOrc: false }),
};

module.exports = { samples, ompO09, segment, msh, build };
