function imageUrlFor(filename) {
  return filename ? `/assets/images/${encodeURIComponent(filename)}` : null;
}

module.exports = { imageUrlFor };
