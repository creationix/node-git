# node-git

This is a thin wrapper around the command-line `git` command for use inside node applications.  It's used primarily by the [wheat][] blogging system to enable a running node.JS server to read files out of a git repository as if they were local files.

## Example usage

    var sys = require('sys'),
        Git = require('git');
    
    
    // Test it!
    Git("/Users/tim/code/howtonode.org");
    Git.exists("articles/control-flow-part-ii.markdown", function (err, tags) {
      if (err) { throw(err); }
      sys.p(tags);
    });
    Git.getTags(function (err, tags) {
      if (err) { throw(err); }
      Object.keys(tags).forEach(function (tag) {
        Git.readDir("articles", tags[tag], function (err, contents) {
          if (err) { throw(err); }
          contents.files.forEach(function (file) {
            file = Path.join("articles", file);
            Git.readFile(file, tags[tag], function (err, text) {
              if (err) { throw(err); }
              sys.error("tag: " + tag + " sha1: " + tags[tag] + " file: " + file + " length: " + text.length);
            });
          });
        });
      });
    });

[wheat]: http://github.com/creationix/wheat