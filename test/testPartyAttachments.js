var assert = require('assert');
var sriclient = require('sri4node-client');
var doGet = sriclient.get;
var doPut = sriclient.put;
var needle = require('needle');
var Q = require('q');
var uuid = require('node-uuid');
var useWinston = true;

exports = module.exports = function (base, winston) {
  'use strict';
/*
  function warn(x) {
    if (!useWinston) {
      console.log(x); // eslint-disable-line
    } else {
      winston.log('warn', x);
    }
  }

  function error(x) {
    if (!useWinston) {
      console.log(x); // eslint-disable-line
    } else {
      winston.log('error', x);
    }
  }
*/
  function debug(x) {
    if (!useWinston) {
      console.log(x); // eslint-disable-line
    } else {
      winston.log('debug', x);
    }
  }

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

  describe('/parties', function () {
    describe('PUT', function () {
      it('should allow adding of profile picture as attachment.', function () {
        var body = {
          type: 'person',
          name: 'test user',
          status: 'active'
        };
        var id = uuid.v4();

        debug('Generated UUID=' + id);
        return doPut(base + '/parties/' + id, body, 'annadv', 'test').then(function (response) {
          assert.equal(response.statusCode, 201);
          debug('PUTting the profile image as attachment.');
          var file = '/home/ubuntu/workspace/inner-gerbil/test/orange-boy-icon.png';
          return doPutFile(base + '/parties/' + id + '/profile.png', file, 'annadv', 'test');
        }).then(function (response) {
          assert.equal(response.statusCode, 201);
          return doGet(base + '/parties/' + id + '/profile.png', 'annadv', 'test');
        }).then(function (response) {
          debug('Retrieving of file done');
          debug('status code : ' + response.statusCode);
          debug('body length : ' + response.body.length);
          assert.equal(response.statusCode, 200);
          if (response.body.length && response.body.length < 10000) {
            assert.fail('Response too small, it should be the 10.x Kb image we sent...');
          }
        });
      });
    });
  });
};

// TODO : Test replacing of profile image.
// TODO : Test removing of profile image.
