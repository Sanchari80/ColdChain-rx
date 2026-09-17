'use strict';

const HL7 = require('hl7-standard');
const { badRequest } = require('../../util/errors');

/**
 * Parses the HL7 v2.5.1 pharmacy order message (OMP^O09) that the hospital's
 * legacy order system emits when a ward raises an indent.
 *
 * Parsing is delegated to the Redox `hl7-standard` library. Splitting the raw
 * text on pipes by hand looks like it works until a message arrives with
 * repeating fields, escaped delimiters (\F\, \S\, \T\), non-default encoding
 * characters in MSH-2, or a segment in an unexpected order — at which point a
 * hand-rolled splitter silently mis-reads a drug name.
 */

const SEGMENT_TERMINATOR = '\r';

function normalizeLineEndings(raw) {
  return String(raw).replace(/\r\n|\n|\r/g, SEGMENT_TERMINATOR).trim();
}

function textOf(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function numberOf(value) {
  const text = textOf(value);
  if (text === null) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** HL7 timestamps are YYYYMMDDHHMMSS[.S[S[S[S]]]][+/-ZZZZ]. */
function parseHl7DateTime(value) {
  const text = textOf(value);
  if (!text) return null;
  const m = /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(text);
  if (!m) return null;
  const [, year, month = '01', day = '01', hour = '00', minute = '00', second = '00'] = m;
  const offsetMatch = /([+-])(\d{2})(\d{2})$/.exec(text);
  const base = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  const iso = offsetMatch ? `${base}${offsetMatch[1]}${offsetMatch[2]}:${offsetMatch[3]}` : `${base}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function segmentGet(segment, path) {
  try {
    return textOf(segment.get(path));
  } catch {
    return null;
  }
}

function parse(raw) {
  const normalized = normalizeLineEndings(raw);
  if (!normalized.startsWith('MSH')) {
    throw badRequest('HL7 message must start with an MSH segment', { received: normalized.slice(0, 24) });
  }

  const message = new HL7(normalized);
  let parseError = null;
  // hl7-standard's transform is synchronous under the hood; the callback runs
  // before transform() returns, so the result is available immediately after.
  message.transform((err) => {
    if (err) parseError = err;
  });
  if (parseError) {
    throw badRequest('HL7 message could not be parsed', { cause: String(parseError.message || parseError) });
  }

  const get = (path) => {
    try {
      return textOf(message.get(path));
    } catch {
      return null;
    }
  };

  const messageType = get('MSH.9.1');
  const triggerEvent = get('MSH.9.2');
  if (messageType !== 'OMP' || triggerEvent !== 'O09') {
    throw badRequest(`Expected an OMP^O09 pharmacy order, received ${messageType || '?'}^${triggerEvent || '?'}`, {
      messageType,
      triggerEvent,
    });
  }

  const orcSegments = message.getSegments('ORC');
  if (!orcSegments.length) {
    throw badRequest('OMP^O09 is missing its ORC (common order) segment');
  }
  const rxoSegments = message.getSegments('RXO');
  if (!rxoSegments.length) {
    throw badRequest('OMP^O09 is missing its RXO (pharmacy order) segment');
  }

  const rxrSegments = message.getSegments('RXR');
  const nteSegments = message.getSegments('NTE');
  const obxSegments = message.getSegments('OBX');

  const header = {
    sendingApplication: get('MSH.3.1'),
    sendingFacility: get('MSH.4.1'),
    receivingApplication: get('MSH.5.1'),
    receivingFacility: get('MSH.6.1'),
    messageDateTime: parseHl7DateTime(get('MSH.7.1') || get('MSH.7')),
    messageType: `${messageType}^${triggerEvent}`,
    messageControlId: get('MSH.10.1') || get('MSH.10'),
    processingId: get('MSH.11.1') || get('MSH.11'),
    versionId: get('MSH.12.1') || get('MSH.12'),
  };

  if (!header.messageControlId) {
    throw badRequest('MSH-10 (message control id) is required so the ACK can be correlated');
  }

  // PID carries PHI. It is kept in a clearly named sub-object so that every
  // caller has to make a conscious decision to touch it.
  const patient = {
    mrn: get('PID.3.1'),
    assigningAuthority: get('PID.3.4'),
    family: get('PID.5.1'),
    given: [get('PID.5.2'), get('PID.5.3')].filter(Boolean).join(' ') || null,
    birthDate: parseHl7DateTime(get('PID.7.1') || get('PID.7')),
    administrativeSex: get('PID.8.1') || get('PID.8'),
    phone: get('PID.13.1') || get('PID.13'),
    addressLine: get('PID.11.1'),
    city: get('PID.11.3'),
  };

  const visit = {
    patientClass: get('PV1.2.1') || get('PV1.2'),
    ward: get('PV1.3.1'),
    room: get('PV1.3.2'),
    bed: get('PV1.3.3'),
    attendingProvider: get('PV1.7.1'),
    visitNumber: get('PV1.19.1') || get('PV1.19'),
  };

  const orc = orcSegments[0];
  const order = {
    control: segmentGet(orc, 'ORC.1.1') || segmentGet(orc, 'ORC.1'),
    placerOrderNumber: segmentGet(orc, 'ORC.2.1'),
    fillerOrderNumber: segmentGet(orc, 'ORC.3.1'),
    orderStatus: segmentGet(orc, 'ORC.5.1') || segmentGet(orc, 'ORC.5'),
    quantityTiming: {
      interval: segmentGet(orc, 'ORC.7.2'),
      startDateTime: parseHl7DateTime(segmentGet(orc, 'ORC.7.4')),
      priority: segmentGet(orc, 'ORC.7.6'),
    },
    transactionDateTime: parseHl7DateTime(segmentGet(orc, 'ORC.9.1') || segmentGet(orc, 'ORC.9')),
    enteredBy: {
      id: segmentGet(orc, 'ORC.10.1'),
      family: segmentGet(orc, 'ORC.10.2'),
      given: segmentGet(orc, 'ORC.10.3'),
    },
    orderingProvider: {
      id: segmentGet(orc, 'ORC.12.1'),
      family: segmentGet(orc, 'ORC.12.2'),
      given: segmentGet(orc, 'ORC.12.3'),
    },
  };

  if (!order.placerOrderNumber) {
    throw badRequest('ORC-2 (placer order number) is required; it is the ward indent number');
  }

  const route = rxrSegments.length
    ? {
      code: segmentGet(rxrSegments[0], 'RXR.1.1'),
      display: segmentGet(rxrSegments[0], 'RXR.1.2'),
      site: segmentGet(rxrSegments[0], 'RXR.2.1'),
    }
    : null;

  const items = rxoSegments.map((segment) => ({
    code: segmentGet(segment, 'RXO.1.1'),
    display: segmentGet(segment, 'RXO.1.2'),
    codeSystem: segmentGet(segment, 'RXO.1.3'),
    amountMinimum: numberOf(segmentGet(segment, 'RXO.2.1') || segmentGet(segment, 'RXO.2')),
    amountMaximum: numberOf(segmentGet(segment, 'RXO.3.1') || segmentGet(segment, 'RXO.3')),
    units: segmentGet(segment, 'RXO.4.1'),
    unitsDisplay: segmentGet(segment, 'RXO.4.2'),
    doseForm: segmentGet(segment, 'RXO.5.2') || segmentGet(segment, 'RXO.5.1'),
    dispenseAmount: numberOf(segmentGet(segment, 'RXO.11.1') || segmentGet(segment, 'RXO.11')),
    dispenseUnits: segmentGet(segment, 'RXO.12.1'),
    route,
  }));

  const notes = nteSegments.map((segment) => segmentGet(segment, 'NTE.3.1')).filter(Boolean);

  const observations = obxSegments.map((segment) => ({
    code: segmentGet(segment, 'OBX.3.1'),
    display: segmentGet(segment, 'OBX.3.2'),
    codeSystem: segmentGet(segment, 'OBX.3.3'),
    value: segmentGet(segment, 'OBX.5.1') || segmentGet(segment, 'OBX.5'),
    units: segmentGet(segment, 'OBX.6.1'),
    observedAt: parseHl7DateTime(segmentGet(segment, 'OBX.14.1') || segmentGet(segment, 'OBX.14')),
  }));

  return { header, patient, visit, order, items, notes, observations, raw: normalized };
}

/**
 * Builds the ACK^O09 the sending system is waiting for. Interfaces that never
 * acknowledge cause the sender to retry the same order, which in a pharmacy
 * means a duplicate dose.
 */
function buildAck(parsedHeader, { accepted = true, errorText = null, sendingApplication = 'COLDCHAIN', sendingFacility = 'MAINPHARM' } = {}) {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');

  const controlId = `ACK${stamp}`;
  const msh = [
    'MSH', '^~\\&',
    sendingApplication,
    sendingFacility,
    parsedHeader.sendingApplication || '',
    parsedHeader.sendingFacility || '',
    stamp, '',
    'ACK^O09',
    controlId,
    parsedHeader.processingId || 'P',
    parsedHeader.versionId || '2.5.1',
  ].join('|');

  const msa = ['MSA', accepted ? 'AA' : 'AE', parsedHeader.messageControlId || '', errorText || ''].join('|');
  return [msh, msa].join(SEGMENT_TERMINATOR);
}

module.exports = { parse, buildAck, parseHl7DateTime, normalizeLineEndings };
