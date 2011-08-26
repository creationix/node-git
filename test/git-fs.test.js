process.env.NODE_ENV = 'test';

var assert = require('assert'),
  Git = require('../lib/git-fs');

Git(__dirname + '/..');

module.exports = {
  'read buffer fs': function (t) {
    Git.readFile('fs', 'test/ascii.txt', function (err, data) {
      assert.ok(!err);
      assert.ok(data instanceof Buffer);
      assert.equal(data.toString(), 'abc\ndef\n123\n');
      t.finish();
    });
  },
  'read buffer head': function (t) {
    Git.getHead(function (err, sha) {
      assert.ok(!err);
      assert.equal(sha.length, 40);
      Git.readFile(sha, 'test/ascii.txt', function (err, data) {
        assert.ok(!err);
        assert.ok(data instanceof Buffer);
        assert.equal(data.toString(), 'abc\ndef\n123\n');
        t.finish();
      });
    }, true);
  },
  'read unicode buffer fs': function (t) {
    Git.readFile('fs', 'test/utf8.txt', function (err, data) {
      assert.ok(!err);
      assert.ok(data instanceof Buffer);
      assert.equal(data.toString(), 'ąbć\ndęf\n123\n');
      t.finish();
    });
  },
  'read unicode buffer head': function (t) {
    Git.getHead(function (err, sha) {
      assert.ok(!err);
      assert.equal(sha.length, 40);
      Git.readFile(sha, 'test/utf8.txt', function (err, data) {
        assert.ok(!err);
        assert.ok(data instanceof Buffer);
        assert.equal(data.toString(), 'ąbć\ndęf\n123\n');
        t.finish();
      });
    }, true);
  },
  'read unicode buffer to string': function (t) {
    Git.readFile('fs', 'test/utf8.txt', 'utf8', function (err, data) {
      assert.ok(!err);
      assert.equal('string', typeof data);
      assert.equal(data, 'ąbć\ndęf\n123\n');
      t.finish();
    });
  },
  'read unicode buffer head to String': function (t) {
    Git.getHead(function (err, sha) {
      assert.ok(!err);
      assert.equal(sha.length, 40);
      Git.readFile(sha, 'test/utf8.txt', 'utf8', function (err, data) {
        assert.ok(!err);
        assert.equal('string', typeof data);
        assert.equal(data, 'ąbć\ndęf\n123\n');
        t.finish();
      });
    }, true);
  },
  'log': function (t) {
    Git.log('lib/git-fs.js', function (err, data) {
      assert.ok(!err);
      assert.equal(data['26c8c846ba48d907ddd093b24b5d51e044c604b0'].author.slice(0, 3), 'Tim');
      t.finish();
    });
  },
  'dir': function (t) {
    Git.readDir('26c8c846ba48d907ddd093b24b5d51e044c604b0', 'lib', function (err, data) {
      assert.ok(!err);
      assert.equal(data.files[0], 'git-fs.js');
      t.finish();
    });
  },
};
