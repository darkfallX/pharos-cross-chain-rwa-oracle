function isValidAddress(addr) {
  return typeof addr === 'string' && /^0x[a-fA-F0-9]{40}$/.test(addr);
}

function createInputError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

module.exports = { isValidAddress, createInputError };
