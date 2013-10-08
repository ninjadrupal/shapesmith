var express = require('express');
var path = require('path');
var nconf = require('nconf');
var app = express();

var requireJS = require('requireJS');
var rootDir = path.normalize(path.join(__dirname, '../..'));
var baseUrl = path.join(__dirname, "..");
requireJS.config({
  baseUrl: baseUrl,
  nodeRequire: require,
});

// ---------- Configuration ----------

// Override with command-line arguments
nconf.argv();
nconf.env();

var app_env = nconf.get('app_env') || 'devel';
switch (app_env) {
case 'functional':
  nconf.file({file: path.join(rootDir, 'config/functional.config.json')});
  break;
case 'devel':
  nconf.file({file: path.join(rootDir, 'config/devel.config.json')});
  break;
default:
  throw new Error('invalid environment:' + app_env);
}

var diskDBPath = path.normalize(path.join(rootDir, nconf.get('diskDBPath')));

console.info("");
console.info("    .                           .  .   ");
console.info(",-. |-. ,-. ,-. ,-. ,-. ,-,-. . |- |-. ");
console.info("`-. | | ,-| | | |-' `-. | | | | |  | | ");
console.info("`-' ' ' `-^ |-' `-' `-' ' ' ' ' `' ' ' ");
console.info("            '                          ");

console.info('\n\nconfiguration:');
console.info('--------------');
console.info('environment: ', app_env);
console.info('port:        ', nconf.get('port'));
console.info('baseUrl:     ', baseUrl);
console.info('disk db path:', diskDBPath);

// ---------- Create db ----------
var DB = requireJS('api/disk_db');
var db = new DB({root: diskDBPath});

app.set('view engine', 'hbs');
app.set('views', path.join(rootDir, 'templates'));

app.use('/images', express.static(path.join(rootDir, 'static', 'images')));
app.use('/css', express.static(path.join(rootDir, 'static', 'css')));
app.use('/src/', express.static(path.join(rootDir, 'src')));
app.use('/src/node_modules', express.static(path.join(rootDir, 'node_modules')));
app.use('/node_modules', express.static(path.join(rootDir, 'node_modules')));
app.use('/lib', express.static(path.join(rootDir, 'src/lib')));

app.use(express.cookieParser());
app.use(express.session({secret: '1234567890QWERTY'}));
app.use(express.bodyParser());

// app.use(express.logger());

var authMiddleware = function(req, res, next) {
  if (req.session.username) {
    next();
  } else if (req.path === '/login') {
    next();
  } else {
    res.redirect('/login');
  }
};

app.use('/ui', authMiddleware);
app.use('/api', authMiddleware);

// Index
app.get('/', function(req, res) {
  res.redirect('/ui/local/designs');
});

// Login
app.get(/^\/login\/?$/, function(req, res) {
  res.render('login');
});

app.post(/^\/login\/?$/, function(req, res) {
  if ((req.body.username === 'a') && (req.body.password === 'a')) {
    req.session.username = 'a';
    res.redirect('/');
  } else {
    res.render('login');
  }
});

// Logout
app.get(/^\/logout\/?$/, function(req, res) {
  req.session.username = undefined;
  res.redirect('/');
});


// Designs UI
app.get(/^\/ui\/([\w%]+)\/designs\/?$/, function(req, res) {
  var user = decodeURI(req.params[0]);
  res.render('designs', {user: user});
});

// Designs API
app.get(/^\/api\/([\w%]+)\/designs\/?$/, function(req, res) {
  var user = decodeURI(req.params[0]);
  db.getDesigns(user, function(err, data) {
    if (err) {
      res.send(500, err);
    } else {
      return res.json(data);
    }
  });
});

// Create design
// TODO: Name doesn't exist
// TODO: Name is valid
app.put(/^\/api\/([\w%]+)\/([\w%]+)\/?$/, function(req, res) {

  var user = decodeURI(req.params[0]);
  var design = decodeURI(req.params[1]);

  // 1. Create the path for the designs
  // 2. Create the empty graph
  // 3. Create the refs
  // 4. Add the design to the list of designs

  db.createDesignPath(user, design, function(err) {
    if (err) {
      if (err === 'already_exists') {
        res.send(409, 'already exists');
      } else {
        res.send(500, err);
      }
    } else {

      var emptyGraph = {
        vertices: [],
        edges: [],
        metadata: [],
      };

      db.createGraph(user, design, emptyGraph, function(err, sha) {
        if (err) {
          res.send(500, err);
        } else {

          var refs = {
            'heads' : {
              'master': sha
            }
          };

          db.createRefs(user, design, refs, function(err) {
            if (err) {
              res.send(500, err);
            } else {

              db.addDesign(user, design, function(err) {
                if (err) {
                  res.send(500, err);
                } else {
                  res.json(refs);
                }
              });
            }
          });
        }
      });
    }
  });
});

// Rename design.
// NB! This is not safe if multiple requests change
// the list of designs at the same time!
app.post(/^\/api\/([\w%]+)\/([\w%]+)\/?$/, function(req, res) {
  var user = decodeURI(req.params[0]);
  var design = decodeURI(req.params[1]);
  if (!req.body.newName) {
    res.json(400, 'no newName parameter');
  } else if (!/^[a-zA-Z_][a-zA-Z0-9-_\\s]*$/.test(req.body.newName)) {
    res.json(400, 'invalid new name');
  } else {
    var newName = req.body.newName;
    db.renameDesign(user, design, newName, function(err, data) {
      if (err) {
        if (err === 'alreadyExists') {
          res.send(409, 'already exists');
        } else {
          res.send(500, err);
        }
      } else {
        res.json(data);
      }
    });
  }
});

// Delete design
app.delete(/^\/api\/([\w%]+)\/([\w%]+)\/?$/, function(req, res) {
  var user = decodeURI(req.params[0]);
  var design = decodeURI(req.params[1]);
  db.deleteDesign(user, design, function(err, data) {
    if (err) {
      if (err === 'notFound') {
        res.send(404, 'not found');
      } else {
        res.send(500, err);
      }
    } else {
      res.json(data);
    }
  });
});

// Get Refs
app.get(/^\/api\/([\w%]+)\/([\w%]+)\/refs$/, function(req, res) {
  var user = decodeURI(req.params[0]);
  var design = decodeURI(req.params[1]);
  db.getRefs(user, design, function(err, data) {
    if (err) {
      res.send(500, err);
    } else {
      res.json(data);
    }
  });
});

// Update ref
app.put(/^\/api\/([\w%]+)\/([\w%]+)\/refs\/(\w+)\/(\w+)\/?$/, function(req, res) {
  var user = decodeURI(req.params[0]);
  var design = decodeURI(req.params[1]);
  var type = req.params[2];
  var ref = req.params[3];
  db.updateRefs(user, design, type, ref, req.body, function(err, data) {
    if (err) {
      res.send(500, err);
    } else {
      res.json(data);
    }
  });

});

// Modeller UI
app.get(/^\/ui\/([\w%]+)\/([\w%]+)\/modeller$/, function(req, res) {
  var user = decodeURI(req.params[0]);
  var design = decodeURI(req.params[1]);
  res.render('modeller', {user: user, design: design});
});


// Create graph
app.post(/^\/api\/([\w%]+)\/([\w%]+)\/graph\/?$/, function(req, res) {
  var user = decodeURI(req.params[0]);
  var design = decodeURI(req.params[1]);
  var graph = req.body;
  db.createGraph(user, design, graph, function(err, sha) {
    if (err) {
      res.send(500, err);
    } else {
      res.json(sha);
    }
  });
});

// Get graph
app.get(/^\/api\/([\w%]+)\/([\w%]+)\/graph\/([\w%]+)\/?$/, function(req, res) {
  var user = decodeURI(req.params[0]);
  var design = decodeURI(req.params[1]);
  var sha = req.params[2];
  db.getGraph(user, design, sha, function(err, data) {
    if (err) {
      res.send(500, err);
    } else {
      return res.json(data);
    }
  });
});

// Create vertex
app.post(/^\/api\/([\w%]+)\/([\w%]+)\/vertex\/?$/, function(req, res) {
  var user = decodeURI(req.params[0]);
  var design = decodeURI(req.params[1]);
  var vertex = req.body;
  db.createVertex(user, design, vertex, function(err, sha) {
    if (err) {
      res.send(500, err);
    } else {
      res.json(sha);
    }
  });
});

// Get vertex
app.get(/^\/api\/([\w%]+)\/([\w%]+)\/vertex\/([\w%]+)\/?$/, function(req, res) {
  var user = decodeURI(req.params[0]);
  var design = decodeURI(req.params[1]);
  var sha = req.params[2];
  db.getVertex(user, design, sha, function(err, data) {
    if (err) {
      if (err === 'notFound') {
        res.send(404, 'not found');
      } else {
        res.send(500, err);
      }
    } else {
      return res.json(data);
    }
  });
});

// For controlling the process (e.g. via Erlang) - stop the server
// when stdin is closed
process.stdin.resume();
process.stdin.on('end', function() {
  process.exit();
});

// var port = nconf.get('port');
// app.listen(port);
// console.info('--------------');
// console.info('server started on :' + port + '\n');

module.exports = app;