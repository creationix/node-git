/*
Copyright (c) 2010 Tim Caswell <tim@creationix.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

var Tools = require('./tools');

var ChildProcess = require('child_process'),
    Path = require('path'),
    fs = require('fs');

// Keep stable stuff in memory 1 hour (in ms), 100ms for volatile stuff.
var CACHE_LIFE = [36300000, 100];

// effectively disable caching when testing
if (process.env.NODE_ENV === 'test') {
  CACHE_LIFE[0] = 100;
}

var gitCommands, gitDir, workTree;

var gitENOENT = /fatal: (Path '([^']+)' does not exist in '([0-9a-f]{40})'|ambiguous argument '([^']+)': unknown revision or path not in the working tree.)/;

// Set up the git configs for the subprocess
var Git = module.exports = function (repo) {
  // Check the directory exists first.
  try {
    fs.statSync(repo);
  } catch (e) {
    throw new Error("Bad repo path: " + repo);
  }
  try {
    // Check is this is a working repo
    gitDir = Path.join(repo, ".git")
    fs.statSync(gitDir);
    workTree = repo;
    gitCommands = ["--git-dir=" + gitDir, "--work-tree=" + workTree];
  } catch (e) {
    gitDir = repo;
    gitCommands = ["--git-dir=" + gitDir];
  }

};

// Decorator for async function that handles caching and concurrency queueing
// Anything with a 40 character hash version can be cached indefinetly, if the
// version is "fs" that means we're reading from the file system and will use
// an expiring cache.
function safe(fn) {
  var cache = {};
  var queue = {};
  return function (version) {
    var args = Array.prototype.slice.call(arguments, 0, arguments.length - 1);
    var key = args.join(":");
    var callback = arguments[arguments.length - 1];

    if (!(version.length === 40 || version == "fs")) {
      callback(new Error("Invalid version " + version));
      return;
    }

    // Check local cache
    if (cache[key]) { process.nextTick(function () {
      callback(null, cache[key]);
    }); return; }
    // Check if there is a line already
    if (queue[key]) { queue[key].push(callback); return; }
    // Otherwise, create a queue
    var localQueue = queue[key] = [callback];

    args[args.length] = function (err, value) {

      // If success, cache the value
      if (value) {
        cache[key] = value;
        // arguments[2] = time;
        // Set a timer to expire this cache item
        setTimeout(function () {
          cache[key] = false;
        }, version === 'fs' ? CACHE_LIFE[1] : CACHE_LIFE[0]);
      }

      // Flush the queue
      for (var i = 0, l = localQueue.length; i < l; i++) {
        localQueue[i].apply(this, arguments);
      }
      queue[key] = false;

    };
    fn.apply(this, args);
  }

}

// Gets the sha for HEAD based on /HEAD and /packed-refs directly
var shaCache;
var shaQueue;
function getHeadSha(callback) {
  // Pull from cache if possible
  if (shaCache) { callback(null, shaCache); return; }
  // Add our callback to the queue if there is already a query in progress
  if (shaQueue) { shaQueue[shaQueue.length] = callback; return; }
  // Make sure we have a directory to read from
  if (!gitDir) { callback(new Error("gitDir not set yet!")); return; }

  // Start a new queue with our callback
  shaQueue = [callback];
  function groupCallback(err, sha) {
    for (var i = 0, l = shaQueue.length; i < l; i++) {
      shaQueue[i].apply(this, arguments);
    }
    shaQueue = false;
  }

  var head, packedRefs, master;
  
  Path.exists(Path.join(gitDir, "packed-refs"), function (exists) {
    if(exists) {
      getHEAD();
    }
    else {
      gitExec(["gc"],function (err) {
        getHEAD();
      });
    }
  });
  
  function getHEAD() {
    fs.readFile(Path.join(gitDir, "packed-refs"), "ascii", function (err, result) {
      if (err) { groupCallback(err); return; }
      packedRefs = result;
      checkDone();
    });
    fs.readFile(Path.join(gitDir, "HEAD"), "ascii", function (err, result) {
      if (err) { groupCallback(err); return; }
      try {
        head = result.match(/^ref: (.*)\n$/)[1]
      } catch (err) { groupCallback(err); return; }
      fs.readFile(Path.join(gitDir, head), "ascii", function (err, result) {
        master = result || null;
        checkDone();
      });
      checkDone();
    });
  }

  // When they're both done, parse out the sha and return it.
  function checkDone() {
    // Make sure all files have been read
    if (!(head && packedRefs && typeof master !== 'undefined')) { return; }
    // Parse the sha1 out of the files.
    try {
      if (master) {
        shaCache = master.match(/([a-f0-9]{40})\n/)[1];
      } else {
        shaCache = packedRefs.match(
          new RegExp("([a-f0-9]{40}) " + head)
        )[1];
      }
    } catch (err) { groupCallback(err); return; }

    // return the value to the caller's callback
    groupCallback(null, shaCache);

    // Leave the cache alive for a little bit in case of heavy load.
    setTimeout(function () { shaCache = false; }, CACHE_LIFE[1]);
  }
}

// Internal helper to talk to the git subprocess
function gitExec(commands, encoding, callback) {
  commands = gitCommands.concat(commands);
  var child = ChildProcess.spawn("git", commands);
  var stdout = [], stderr = [];
  child.stdout.addListener('data', function (text) {
    stdout[stdout.length] = text;
  });
  child.stderr.addListener('data', function (text) {
    stderr[stderr.length] = text;
  });
  var exitCode;
  child.addListener('exit', function (code) {
    exitCode = code;
  });
  child.addListener('close', function () {
    if (exitCode > 0) {
      var err = new Error("git " + commands.join(" ") + "\n" + Tools.join(stderr, 'utf8'));
      if (gitENOENT.test(err.message)) {
        err.errno = process.ENOENT;
      }
      callback(err);
      return;
    }
    callback(null, Tools.join(stdout, encoding));
  });
  child.stdin.end();
}



var logFile = safe(function logFile(version, path, callback) {
  // Get the data from a git subprocess at the given sha hash.
  var commands;
  var args = ["log", "-z", "--summary", version, "--", path];

  gitExec(args, 'utf8', function (err, text) {
    if (err) { callback(err); return; }
    var log = {};
    if (text.length === 0) { callback(null, []); return; }
    text.split("\0").forEach(function (entry) {
      var commit = entry.match(/^commit ([a-f0-9]{40})/)[1];
      var data = {
        message: entry.match(/\n\n([\s\S]*)/)[1].trim()
      }
      entry.match(/^[A-Z][a-z]*:.*$/gm).forEach(function (line) {
        var matches = line.match(/^([A-Za-z]+):\s*(.*)$/);
        data[matches[1].toLowerCase()] = matches[2];
      });
      log[commit] = data;
    });
    callback(null, log);

  });

});

Git.log = function (path, callback) {
  getHeadSha(function (err, version) {
    if (err) { callback(err); return; }
    logFile(version, path, callback);
  });
}

// Loads a file from a git repo
Git.readFile = safe(function readFile(version, path, encoding, callback) {
  // encoding is optional - if not specified we will return Buffer (not string)
  if(callback == null) {
    callback = encoding;
    encoding = null;
  }

  // Get the data from a git subprocess at the given sha hash.
  if (version.length === 40) {
    gitExec(["show", version + ":" + path], encoding, callback);
    return;
  }

  // Or load from the fs directly if requested.
  fs.readFile(Path.join(workTree, path), encoding, function (err, data) {
    if (err) {
      if (err.errno === process.ENOENT) {
        err.message += " " + JSON.stringify(path);
      }
      callback(err); return;
    }
    callback(null, data);
  });

});

// Reads a directory at a given version and returns an objects with two arrays
// files and dirs.
Git.readDir = safe(function readDir(version, path, callback) {

  // Load the directory listing from git is a sha is requested
  if (version.length === 40) {
    Git.readFile(version, path, 'utf-8', function (err, text) {
      if (err) { callback(err); return; }
      if (!(/^tree .*\n\n/).test(text)) {
        callback(new Error(combined + " is not a directory"));
        return;
      }

      text = text.replace(/^tree .*\n\n/, '').trim();
      var files = [];
      var dirs = [];
      text.split("\n").forEach(function (entry) {
        if (/\/$/.test(entry)) {
          dirs[dirs.length] = entry.substr(0, entry.length - 1);
        } else {
          files[files.length] = entry;
        }
      })
      callback(null, {
        files: files,
        dirs: dirs
      });
    });
    return;
  }

  // Otherwise read from the file system.
  var realPath = Path.join(workTree, path);
  fs.readdir(realPath, function (err, filenames) {
    if (err) { callback(err); return; }
    var count = filenames.length;
    var files = [];
    var dirs = [];
    filenames.forEach(function (filename) {
      fs.stat(Path.join(realPath, filename), function (err, stat) {
        if (err) { callback(err); return; }
        if (stat.isDirectory()) {
          dirs[dirs.length] = filename;
        } else {
          files[files.length] = filename;
        }
        count--;
        if (count === 0) {
          callback(null, {
            files: files,
            dirs: dirs
          });
        }
      });
    });
  });

});

// Generates a proper version string for external programs that want the
// newest version in the repository.  For working trees, this is the actual
// files on the HD, for bare repos this is the HEAD revision.
Git.getHead = function getHead(callback, forceHead) {
  if (workTree && !forceHead) { callback(null, 'fs'); return };
  getHeadSha(callback);
}

// Expose the "safe" decorator so function that are dependent on a sha version
// can also be optimized.
Git.safe = safe;
