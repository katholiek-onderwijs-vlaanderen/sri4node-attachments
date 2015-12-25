/*eslint-env node, mocha */

var express = require('express');
var pg = require('pg');
var sri4node = require('sri4node');

var app = express();

var verbose = true;
var winston = require('winston');
winston.level = verbose ? 'debug' : 'info';

var mapping = require('./config.js')(sri4node, verbose, winston);
var port = 5000;
var base = 'http://localhost:' + port;

function info(x) {
  'use strict';
  winston.log('info', x);
}

function error(x) {
  'use strict';
  winston.log('error', x);
}

describe('sri4node-attachments : ', function () {
  'use strict';
  before(function (done) {
    sri4node.configure(app, pg, mapping).then(function () {
      app.set('port', port);
      app.listen(port, function () {
        info('Node app is running at localhost:' + port);
        done();
      });
    }).catch(function (err) {
      error('Unable to start server.');
      error(err);
      error(err.stack);
      done();
    });
  });
  require('./testPartyAttachments.js')(base, winston);
});
