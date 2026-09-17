'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.LOG_LEVEL = 'silent';
const hl7 = require('../src/services/hl7/omp09');
const { samples, ompO09 } = require('../src/services/hl7/samples');

test('parses a well formed OMP^O09', () => {
  const parsed = hl7.parse(samples.valid());

  assert.equal(parsed.header.messageType, 'OMP^O09');
  assert.equal(parsed.header.messageControlId, 'MSG00012');
  assert.equal(parsed.header.versionId, '2.5.1');
  assert.equal(parsed.order.placerOrderNumber, 'IND-2026-0091');
  assert.equal(parsed.order.fillerOrderNumber, 'PH-2026-0091');
  assert.equal(parsed.order.orderingProvider.id, 'PHY4410');
  assert.equal(parsed.visit.ward, 'IPD-7B');
  assert.equal(parsed.visit.room, '712');
  assert.equal(parsed.visit.bed, 'A');
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].code, '311041');
  assert.equal(parsed.items[0].codeSystem, 'RXNORM');
  assert.equal(parsed.items[0].amountMinimum, 18);
  assert.equal(parsed.items[0].route.code, 'SC');
  assert.equal(parsed.observations[0].code, '8329-5');
  assert.equal(parsed.notes.length, 1);
});

test('reads PID demographics but keeps them in their own block', () => {
  const parsed = hl7.parse(samples.valid());
  assert.equal(parsed.patient.mrn, 'MRN0012345');
  assert.equal(parsed.patient.family, 'Rahman');
  assert.equal(parsed.patient.birthDate.slice(0, 10), '1978-04-12');
  // Nothing identifying leaks into the order or item structures.
  assert.equal(JSON.stringify(parsed.order).includes('Rahman'), false);
  assert.equal(JSON.stringify(parsed.items).includes('MRN0012345'), false);
});

test('accepts both CR and CRLF segment terminators', () => {
  const crlf = samples.valid().split('\r').join('\r\n');
  const parsed = hl7.parse(crlf);
  assert.equal(parsed.order.placerOrderNumber, 'IND-2026-0091');
});

test('handles repeating RXO segments', () => {
  const base = samples.valid().split('\r');
  const extra = 'RXO|313782^Acetaminophen 325 MG Oral Tablet^RXNORM|325|325|mg^milligram^UCUM|TAB^Tablet^HL70162';
  const parsed = hl7.parse([...base, extra].join('\r'));
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[1].code, '313782');
});

test('preserves escaped delimiters inside a drug name', () => {
  // \T\ is the HL7 escape for the ampersand used as a sub-component separator.
  const message = ompO09({ drugName: 'Alpha \\T\\ Beta Injection' });
  const parsed = hl7.parse(message);
  assert.ok(parsed.items[0].display.includes('Beta Injection'));
});

test('rejects a message that is not OMP^O09', () => {
  assert.throws(() => hl7.parse(samples.wrongMessageType()), /Expected an OMP\^O09/);
});

test('rejects a message with no ORC segment', () => {
  assert.throws(() => hl7.parse(samples.missingOrc()), /ORC/);
});

test('rejects anything that does not start with MSH', () => {
  assert.throws(() => hl7.parse('PID|1||X'), /must start with an MSH/);
});

test('builds an accept ACK that echoes the original control id', () => {
  const parsed = hl7.parse(samples.valid());
  const ack = hl7.buildAck(parsed.header, { accepted: true });
  const [msh, msa] = ack.split('\r');
  assert.ok(msh.startsWith('MSH|^~\\&|'));
  assert.ok(msh.includes('ACK^O09'));
  assert.equal(msa.split('|')[1], 'AA');
  assert.equal(msa.split('|')[2], 'MSG00012');
});

test('builds a reject ACK carrying the error text', () => {
  const ack = hl7.buildAck({ messageControlId: 'MSG00099' }, { accepted: false, errorText: 'missing ORC' });
  const msa = ack.split('\r')[1].split('|');
  assert.equal(msa[1], 'AE');
  assert.equal(msa[3], 'missing ORC');
});

test('converts HL7 timestamps to ISO, including offsets', () => {
  assert.equal(hl7.parseHl7DateTime('20260916101500').slice(0, 19), '2026-09-16T10:15:00');
  assert.equal(hl7.parseHl7DateTime('19780412'), '1978-04-12T00:00:00.000Z');
  assert.equal(hl7.parseHl7DateTime(''), null);
  assert.equal(hl7.parseHl7DateTime('not-a-date'), null);
});
