function escapeCSVField(field) {
  if (field === null || field === undefined) {
    return '';
  }
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function convertToCSV(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return '';
  }

  const headers = Object.keys(data[0]);
  const headerRow = headers.map(escapeCSVField).join(',');

  const rows = data.map((item) => {
    return headers.map((header) => escapeCSVField(item[header] || '')).join(',');
  });

  return [headerRow, ...rows].join('\n');
}

module.exports = {
  convertToCSV,
};

