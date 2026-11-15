import { jsPDF } from 'jspdf';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';

import type { FieldVisit, FieldVisitReportAttachment, NationalPark } from '../../services/api';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;
const PDF_MIME = 'application/pdf' as const;

const LABELS: Record<string, string> = {
  planned: 'Planeada',
  in_progress: 'Em curso',
  completed: 'Concluída',
  inconclusive: 'Inconclusiva',
  cancelled: 'Cancelada / sem acesso',
  active_fire_signs: 'Fogo ativo confirmado',
  burn_scars: 'Vestígios de queimada',
  controlled_burn: 'Queimada controlada autorizada',
  false_positive: 'Falso positivo / Sem sinais',
  no_signs_observed: 'Sem sinais observados',
  unable_to_verify: 'Não foi possível verificar',
  access_impossible: 'Sem acesso ao local',
  operational: 'Operação real',
  simulation: 'Simulação / treino',
  detection: 'Deteção NASA FIRMS',
  manual: 'Registo manual / patrulha de rotina',
};

function valueLabel(value: string | null | undefined): string {
  return value ? LABELS[value] ?? value : 'Não registado';
}

function localDate(value: string | null): string {
  if (!value) return 'Não registada';
  return new Date(value).toLocaleString('pt-MZ', { timeZone: 'Africa/Maputo' });
}

function areaLabel(park: NationalPark): string {
  return `${park.name}${park.province ? ` - ${park.province}` : ''}`;
}

function reportRows(visit: FieldVisit, park: NationalPark): Array<[string, string]> {
  const recordType = visit.record_type ?? (
    visit.satellite_observation_id ? 'detection' : 'manual'
  );
  return [
    ['Referência', visit.report_reference ?? visit.client_id],
    ['Área de conservação', areaLabel(park)],
    ['Natureza do registo', valueLabel(recordType)],
    ['Deteção ID', visit.satellite_observation_id ?? 'Registo manual'],
    ['Sensor / satélite', visit.instrument ? `${visit.instrument} / ${visit.satellite ?? 'Não indicado'}` : 'Não aplicável'],
    ['Feed / fonte', visit.satellite_feed ?? visit.source ?? 'Não aplicável'],
    ['Deteção UTC', visit.satellite_detection_date
      ? `${visit.satellite_detection_date} ${visit.satellite_detection_time_utc ?? ''} UTC`
      : 'Não aplicável'],
    ['Coordenadas do satélite', visit.satellite_latitude != null && visit.satellite_longitude != null
      ? `${visit.satellite_latitude}, ${visit.satellite_longitude}`
      : 'Não aplicável'],
    ['Estado da missão', valueLabel(visit.status)],
    ['Resultado principal', valueLabel(visit.observed_result)],
    ['Data e hora da visita (CAT)', localDate(visit.actual_visit_at_utc ?? visit.scheduled_at_utc)],
    ['Guarda / observador responsável', visit.lead_ranger || 'Não registado'],
    ['Setor / zona do parque', visit.unit_sector || 'Não registado'],
    ['Coordenadas confirmadas no terreno', visit.field_latitude != null && visit.field_longitude != null
      ? `${visit.field_latitude}, ${visit.field_longitude}`
      : 'Não registadas'],
    ['Classificação', valueLabel(visit.classification)],
    ['Resumo da observação', visit.notes || 'Sem notas adicionais'],
  ];
}

function addPdfImage(pdf: jsPDF, dataUrl: string, y: number): number {
  const width = 165;
  const height = 92;
  if (y + height > 270) {
    pdf.addPage();
    y = 18;
  }
  pdf.addImage(dataUrl, dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG', 22, y, width, height);
  return y + height + 10;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function imageRun(dataUrl: string): ImageRun {
  const [header, encoded = ''] = dataUrl.split(',');
  const binary = atob(encoded);
  const data = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const extension = header.includes('image/png') ? 'png' : 'jpg';
  return new ImageRun({
    data,
    type: extension,
    transformation: { width: 480, height: 320 },
  });
}

export async function buildAndDownloadFieldVisitDocuments(
  visit: FieldVisit,
  park: NationalPark,
  download = true,
  format: 'pdf' | 'docx' | 'both' = 'both',
): Promise<[FieldVisitReportAttachment, FieldVisitReportAttachment]> {
  const filenameBase = (visit.report_reference ?? visit.client_id).toLowerCase();
  const pdf = new jsPDF();
  const title = 'Ficha de Observação de Campo';
  pdf.setFontSize(18);
  pdf.text(title, 20, 20);
  pdf.setFontSize(11);
  pdf.text(areaLabel(park), 20, 28);
  pdf.setFontSize(9);
  pdf.text(`Firewatch · ${visit.report_reference ?? visit.client_id}`, 20, 35);
  let y = 45;
  for (const [label, value] of reportRows(visit, park)) {
    const lines = pdf.splitTextToSize(`${label}: ${value}`, 170);
    if (y + lines.length * 5 > 275) {
      pdf.addPage();
      y = 18;
    }
    pdf.text(lines, 20, y);
    y += lines.length * 5 + 2;
  }
  if (visit.evidence_image_data_url) {
    pdf.setFontSize(12);
    if (y + 10 > 275) {
      pdf.addPage();
      y = 18;
    }
    pdf.text('Fotografia / evidência', 20, y);
    y = addPdfImage(pdf, visit.evidence_image_data_url, y + 5);
  }
  if (y + 38 > 275) {
    pdf.addPage();
    y = 18;
  }
  pdf.setFontSize(10);
  pdf.text('Assinatura do guarda / observador: ______________________________', 20, y + 8);
  pdf.text('Assinatura do responsável do parque: ____________________________', 20, y + 25);
  const pdfBuffer = pdf.output('arraybuffer');
  if (download && format !== 'docx') {
    saveBlob(new Blob([pdfBuffer], { type: PDF_MIME }), `${filenameBase}.pdf`);
  }

  const children: Paragraph[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
    new Paragraph({ text: areaLabel(park), alignment: AlignmentType.CENTER }),
    new Paragraph({ text: `Firewatch · ${visit.report_reference ?? visit.client_id}`, alignment: AlignmentType.CENTER }),
    new Paragraph(''),
  ];
  let currentSection = '';
  for (const [label, value] of reportRows(visit, park)) {
    const section = label === 'Deteção ID'
      ? 'A. Dados da missão e equipa'
      : label === 'Estado da missão'
        ? 'B. Diagnóstico no terreno'
        : label === 'Classificação'
          ? 'C. Evidências e natureza do registo'
          : currentSection;
    if (label === 'Referência' || label === 'Área de conservação' || label === 'Natureza do registo') {
      children.push(new Paragraph({ children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value)] }));
      continue;
    }
    if (section !== currentSection) {
      currentSection = section;
      children.push(new Paragraph({ text: currentSection, heading: HeadingLevel.HEADING_1 }));
    }
    children.push(new Paragraph({ children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value)] }));
  }
  if (visit.evidence_image_data_url) {
    children.push(new Paragraph({ text: 'Fotografia / evidência', heading: HeadingLevel.HEADING_1 }));
    children.push(new Paragraph({ children: [imageRun(visit.evidence_image_data_url)] }));
  }
  children.push(
    new Paragraph(''),
    new Paragraph('Assinatura do guarda / observador: ______________________________'),
    new Paragraph(''),
    new Paragraph('Assinatura do responsável do parque: ____________________________'),
  );
  const docxBlob = await Packer.toBlob(new Document({ sections: [{ children }] }));
  if (download && format !== 'pdf') saveBlob(docxBlob, `${filenameBase}.docx`);
  const docxBuffer = await docxBlob.arrayBuffer();
  return [
    {
      filename: `${filenameBase}.pdf`,
      content_type: PDF_MIME,
      content_base64: bytesToBase64(pdfBuffer),
    },
    {
      filename: `${filenameBase}.docx`,
      content_type: DOCX_MIME,
      content_base64: bytesToBase64(docxBuffer),
    },
  ];
}
