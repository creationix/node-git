
function join(arr, encoding) {
  var result, index = 0, length;
  length = arr.reduce(function(l, b) {
    return l + b.length;
  }, 0);
  result = new Buffer(length);
  arr.forEach(function(b) {
    b.copy(result, index);
    index += b.length;
  });
  if (encoding) {
    return result.toString(encoding);
  }
  return result;
}

module.exports = {
  join: join
};
