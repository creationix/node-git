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

var ChildProcess = require('child_process'),
    Path = require('path'),
    fs = require('fs');

var gitCommands, gitDir, workTree;

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
  
  // Read the HEAD and packed-refs files in parallel
  var head, packedRefs;
  fs.readFile(Path.join(gitDir, "packed-refs"), function (err, result) {
    if (err) { groupCallback(err); return; }
    packedRefs = result;
    checkDone();
  });
  fs.readFile(Path.join(gitDir, "HEAD"), function (err, result) {
    if (err) { groupCallback(err); return; }
    head = result;
    checkDone();
  });
  
  // When they're both done, parse out the sha and return it.
  function checkDone() {
    // Make sure both files have been read
    if (!(head && packedRefs)) { return; }
    // Parse the sha1 out of the two files.
    try {
      shaCache = packedRefs.match(
        new RegExp("([a-f0-9]{40}) " + head.match(/^ref: (.*)\n$/)[1])
      )[1];
    } catch (err) { groupCallback(err); return; }
    
    // return the value to the caller's callback
    groupCallback(null, shaCache);

    // Leave the cache alive for a little bit in case of heavy load.
    setTimeout(function () { shaCache = false; }, 100);
  }
}

// Internal helper to talk to the git subprocess
function gitExec(commands, callback) {
  commands = gitCommands.concat(commands);
  var child = ChildProcess.spawn("git", commands);
  var stdout = [], stderr = [];
  child.stdout.setEncoding('binary');
  child.stdout.addListener('data', function (text) {
    stdout[stdout.length] = text;
  });
  child.stderr.addListener('data', function (text) {
    stderr[stderr.length] = text;
  });
  child.addListener('exit', function (code) {
    if (code > 0) {
      callback(new Error("git " + commands.join(" ") + "\n" + stderr.join('')));
      return;
    }
    callback(null, stdout.join(''));
  });
  child.stdin.end();
}

// Loads a file from a git repo
var fileCache = {};
var fileQueue = {};
Git.readFile = function readFile(path, version, callback) {

  // Look for optional version parameter
  if (typeof version === 'function' && typeof callback === 'undefined') {
    callback = version;
    // If we're on a working directory, then read the file from the fs
    if (workTree) { Git.readFile(path, "fs", callback); return; }
    // Otherwise look up the sha for HEAD and call again
    getHeadSha(function (err, sha) {
      if (err) { callback(err); return; }
      Git.readFile(path, sha, callback);
    })
    return;
  }
  
  var key = version + ":" + path;
  // Check if it's already cached
  if (fileCache[key]) { callback(null, fileCache[key]); return; }
  // Check if there is a query already running.
  if (fileQueue[key]) { fileQueue[key].push(callback); return; }
  // Create a new queue for pending requests
  var queue = fileQueue[key] = [callback];
  function groupCallback(err, data) {
    for (var i = 0, l = queue.length; i < l; i++) {
      queue[i].apply(this, arguments);
    }
    if (data) { fileCache[key] = data; }
    fileQueue[key] = false;
  }
  
  if (version === 'fs') {
    fs.readFile(Path.join(workTree, path), 'binary', function (err, data) {
      if (err) { groupCallback(err); return; }
      groupCallback(null, data);
      // Expire the cache after a while for static files.
      setTimeout(function () { fileCache[key] = false; }, 100);
    });
    return;
  }
  
  // Get the data from the subprocess
  gitExec(["show", key], groupCallback);
};

// Reads a directory at a given version and returns an objects with two arrays
// files and dirs.
var dirCache = {};
var dirQueue = {};
Git.readDir = function readDir(path, version, callback) {
  // version defaults to HEAD
  if (typeof version === 'function' && typeof callback === 'undefined') {
    callback = version;

    // Read from the fs if we're in a working tree.
    if (workTree) { Git.readDir(path, "fs", callback); return; }
  
    // Otherwise look up the sha for HEAD and call again
    getHeadSha(function (err, sha) {
      if (err) { callback(err); return; }
      Git.readDir(path, sha, callback);
    })
    return;
  }
  
  var key = version + ":" + path;
  // Check if it's already cached
  if (dirCache[key]) { callback(null, dirCache[key]); return; }
  // Check if there is a query already running.
  if (dirQueue[key]) { dirQueue[key].push(callback); return; }
  // Create a new queue for pending requests
  var queue = dirQueue[key] = [callback];
  function groupCallback(err, dirs) {
    for (var i = 0, l = queue.length; i < l; i++) {
      queue[i].apply(this, arguments);
    }
    if (dirs) { dirCache[key] = dirs; }
    dirQueue[key] = false;
  }
  
  if (version === 'fs') {
    var realPath = Path.join(workTree, path);
    fs.readdir(realPath, function (err, filenames) {
      if (err) { groupCallback(err); return; }
      var count = filenames.length;
      var files = [];
      var dirs = [];
      filenames.forEach(function (filename) {
        fs.stat(Path.join(realPath, filename), function (err, stat) {
          if (err) { groupCallback(err); return; }
          if (stat.isDirectory()) {
            dirs[dirs.length] = filename;
          } else {
            files[files.length] = filename;
          }
          count--;
          if (count === 0) {
            groupCallback(null, {
              files: files,
              dirs: dirs
            });
            setTimeout(function () { dirCache[key] = false; }, 100);
          }
        });
      });
    });
    return;
  }
  
  
  Git.readFile(path, version, function (err, text) {
    if (err) { groupCallback(err); return; }
    
    if (!(/^tree .*\n\n/).test(text)) {
      groupCallback(new Error(combined + " is not a directory"));
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
    groupCallback(null, {
      files: files,
      dirs: dirs
    });
  });
};


