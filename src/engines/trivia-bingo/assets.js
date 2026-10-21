// `filename` is a path relative to assets/ (e.g. "images/diyas.jpeg" or
// "country-flags/ad.png") — encode each segment separately so a literal "/"
// in the path isn't itself escaped into "%2F".
function imageUrlFor(filename) {
  if (!filename) return null;
  const encoded = filename.split('/').map(encodeURIComponent).join('/');
  return `/assets/${encoded}`;
}

module.exports = { imageUrlFor };
