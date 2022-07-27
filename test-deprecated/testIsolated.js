var assert = require('assert');
var sriclient = require('sri4node-client');
var doGet = sriclient.get;
var doPut = sriclient.put;
var doDelete = sriclient.delete;
var needle = require('needle');
var Q = require('q');
var uuid = require('node-uuid');
var common = require('../js/common.js');
var debug = common.debug;

exports = module.exports = function (base, type) {
  'use strict';

  function doPutFile(url, filename, user, pwd) {
    var deferred = Q.defer();

    var options = {};
    if (user && pwd) {
      options.username = user;
      options.password = pwd;
    }
    options.multipart = true;

    var data = {
      foo: 'bar',
      image: {file: filename, content_type: 'image/png'} // eslint-disable-line
    };

    needle.put(url, data, options, function (error, response) {
      if (!error) {
        deferred.resolve(response);
      } else {
        deferred.reject(error);
      }
    });

    return deferred.promise;
  }

  describe(type, function () {
    describe('PUT', function () {
      it('should allow adding of profile picture as attachment.', function () {
        var body = {
          type: 'person',
          name: 'test user',
          status: 'active'
        };
        var id = uuid.v4();

        debug('Generated UUID=' + id);
        return doPut(base + type + '/' + id, body, 'annadv', 'test').then(function (response) {
          assert.equal(response.statusCode, 201);
          debug('PUTting the profile image as attachment.');
          var file = 'test/orange-boy-icon.png';
          return doPutFile(base + type + '/' + id + '/profile.png', file, 'annadv', 'test');
        }).then(function (response) {
          assert.equal(response.statusCode, 201);
          return doGet(base + type + '/' + id + '/profile.png', 'annadv', 'test');
        }).then(function (response) {
          debug('Retrieving of file done');
          debug('status code : ' + response.statusCode);
          debug('body length : ' + response.body.length);
          assert.equal(response.statusCode, 200);
          if (!response.body.length || response.body.length < 10000) {
            assert.fail('Response too small, it should be the 10.x Kb image we sent...');
          }
          var file = 'test/little-boy-white.png';
          return doPutFile(base + type + '/' + id + '/profile.png', file, 'annadv', 'test');
        }).then(function (response) {
          assert.equal(response.statusCode, 200);
          return doGet(base + type + '/' + id + '/profile.png', 'annadv', 'test');
        }).then(function (response) {
          assert.equal(response.statusCode, 200);
          if (!response.body.length || response.body.length < 6000 || response.body > 9000) {
            assert.fail('Replaced image should be about 7Kb...');
          }
          // Next : try to delete the resource.
          return doDelete(base + type + '/' + id + '/profile.png', 'annadv', 'test');
        }).then(function (response) {
          assert.equal(response.statusCode, 200);
          // Now check that is is gone..
          return doGet(base + type + '/' + id + '/profile.png', 'annadv', 'test');
        }).then(function (response) {
          assert.equal(response.statusCode, 404);
        });
      });

      it('should be idempotent.', function () {
        var body = {
          type: 'person',
          name: 'test user',
          status: 'active'
        };
        var id = uuid.v4();
        var size;

        debug('Generated UUID=' + id);
        return doPut(base + type + '/' + id, body, 'annadv', 'test').then(function (response) {
          assert.equal(response.statusCode, 201);
          debug('PUTting the profile image as attachment.');
          var file = 'test/orange-boy-icon.png';
          return doPutFile(base + type + '/' + id + '/profile.png', file, 'annadv', 'test');
        }).then(function (response) {
          assert.equal(response.statusCode, 201);
          return doGet(base + type + '/' + id + '/profile.png', 'annadv', 'test');
        }).then(function (response) {
          assert.equal(response.statusCode, 200);
          if (!response.body.length || response.body.length < 10000) {
            assert.fail('Response too small, it should be the 10.x Kb image we sent...');
          }
          size = response.body.length;
          var file = 'test/orange-boy-icon.png';
          return doPutFile(base + type + '/' + id + '/profile.png', file, 'annadv', 'test');
        }).then(function (response) {
          assert.equal(response.statusCode, 200);
          return doGet(base + type + '/' + id + '/profile.png', 'annadv', 'test');
        }).then(function (response) {
          assert.equal(response.statusCode, 200);
          if (!response.body.length || response.body.length !== size) {
            assert.fail('Size should be constant.');
          }
        });
      });
    });

    describe('DELETE', function () {
      it('should be idempotent.', function () {
        var body = {
          type: 'person',
          name: 'test user',
          status: 'active'
        };
        var id = uuid.v4();

        debug('Generated UUID=' + id);
        return doPut(base + type + '/' + id, body, 'annadv', 'test').then(function (response) {
          assert.equal(response.statusCode, 201);
          debug('PUTting the profile image as attachment.');
          var file = 'test/orange-boy-icon.png';
          return doPutFile(base + type + '/' + id + '/profile.png', file, 'annadv', 'test');
        }).then(function (response) {
          assert.equal(response.statusCode, 201);
          return doGet(base + type + '/' + id + '/profile.png', 'annadv', 'test');
        }).then(function (response) {
          debug('Retrieving of file done');
          debug('status code : ' + response.statusCode);
          debug('body length : ' + response.body.length);
          assert.equal(response.statusCode, 200);
          if (!response.body.length || response.body.length < 10000) {
            assert.fail('Response too small, it should be the 10.x Kb image we sent...');
          }
          return doDelete(base + type + '/' + id + '/profile.png', 'annadv', 'test');
        }).then(function (response) {
          assert.equal(response.statusCode, 200);
          // Delete again.
          return doDelete(base + type + '/' + id + '/profile.png', 'annadv', 'test');
        }).then(function (response) {
          assert.equal(response.statusCode, 200);
          // Now check that is is gone..
          return doGet(base + type + '/' + id + '/profile.png', 'annadv', 'test');
        }).then(function (response) {
          assert.equal(response.statusCode, 404);
        });
      });
    });
  });
};
// TODO : Define resource with S3 and file storage to test both
// TODO : When BLOB database storage is implemented, also add a resource on that with tests
// TODO : Implement + check after & before function (with database access) on GET, PUT and DELETE.
