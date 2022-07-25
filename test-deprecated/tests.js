/*eslint-env node, mocha */

var express = require('express');
var pg = require('pg');
var sri4node = require('sri4node');

var app = express();

var verbose = process.env.LOG_DEBUG ? true : false; // eslint-disable-line
var mapping = require('./context/config.js')(sri4node, verbose);
var port = 5000;
var base = 'http://localhost:' + port;

var common = require('../js/common.js');
var info = common.info;
var error = common.error;

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

  require('./testPartyAttachments.js')(base, '/partiesFolder');
  require('./testPartyAttachments.js')(base, '/partiesS3');
  require('../test/unitTests.js');

//  require('./testIsolated.js')(base, '/partiesS3');
});
