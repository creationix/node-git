var assert = require('assert'),
  Tools = require('../lib/tools');

module.exports = {
  'empty': function (t) {
    var r, bufs = [];
    r = Tools.join(bufs);
    assert.ok(r instanceof Buffer);
    assert.equal(r.length, 0);
    t.finish();
  },
  'single': function (t) {
    var r, bufs = [new Buffer('ab\nc')];
    r = Tools.join(bufs);
    assert.ok(r instanceof Buffer);
    assert.equal(r.toString(), 'ab\nc');
    t.finish();
  },
  'no encoding': function (t) {
    var r, bufs = [
      new Buffer('abc'), new Buffer('123'), new Buffer('45')
    ];
    r = Tools.join(bufs);
    assert.ok(r instanceof Buffer);
    assert.equal(r.toString(), 'abc12345');
    t.finish();
  },
  'ascii': function (t) {
    var r, bufs = [
      new Buffer('abc'), new Buffer('123'), new Buffer('45')
    ];
    r = Tools.join(bufs, 'ascii');
    assert.equal(typeof r, 'string');
    assert.equal(r, 'abc12345');
    t.finish();
  },
  'utf8': function (t) {
    var r, bufs = [
      new Buffer('ąbć'), new Buffer('123'), new Buffer('45')
    ];
    r = Tools.join(bufs, 'utf8');
    assert.ok(typeof r, 'string');
    assert.equal(r, 'ąbć12345');
    t.finish();
  }
};
