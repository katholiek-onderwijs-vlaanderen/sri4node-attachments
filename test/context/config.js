/* Configuration for sri4node, used for our server.js, but also for mocha tests */
var Q = require('q');
var sri4nodeAttachments = require('../../sri4node-attachments.js');

var knownIdentities = {};
var knownPasswords = {};

exports = module.exports = function (sri4node, verbose, winston) {
  'use strict';
  var $u = sri4node.utils;

  function error(x) {
    winston.log('error', x);
  }

  var myAuthenticator = function (db, username, password) {
    var deferred = Q.defer();
    var q;

    if (knownPasswords[username]) {
      if (knownPasswords[username] === password) {
        deferred.resolve(true);
      } else {
        deferred.resolve(false);
      }
    } else {
      q = $u.prepareSQL('select-count-from-persons-where-email-and-password');
      q.sql('select count(*) from parties where login = ').param(username).sql(' and password = ').param(password);
      $u.executeSQL(db, q).then(function (result) {
        var count = parseInt(result.rows[0].count, 10);
        if (count === 1) {
          // Found matching record, add to cache for subsequent requests.
          knownPasswords[username] = password;
          deferred.resolve(true);
        } else {
          deferred.resolve(false);
        }
      }).fail(function (err) {
        error('Error checking user on database : ');
        error(err);
        error(err.stack);
        deferred.reject(err);
      });
    }

    return deferred.promise;
  };

  var identity = function (username, database) {
    var deferred = Q.defer();
    var row;
    var ret;
    var query;

    query = $u.prepareSQL('me');
    query.sql('select * from parties where login = ').param(username);
    $u.executeSQL(database, query).then(function (result) {
      row = result.rows[0];
      ret = {
        permalink: '/parties/' + row.key,
        login: row.login,
        name: row.name,
        alias: row.alias,
        dateofbirth: row.dateofbirth,
        imageurl: row.imageurl,
        messages: {href: '/messages?postedByParties=/parties/' + row.key},
        transactions: {href: '/transactions?involvingParties=/parties/' + row.key},
        contactdetails: {href: '/contactdetails?forParties=/parties/' + row.key},
        parents: {href: '/parties?ancestorsOfParties=/parties/' + row.key},
        partyrelations: {href: '/partyrelations?from=/parties/' + row.key}
      };
      if (ret.imageurl === null) {
        delete ret.imageurl;
      }
      if (ret.alias === null) {
        delete ret.alias;
      }
      deferred.resolve(ret);
    }).fail(function (err) {
      error('Error retrieving /me for login [' + username + ']');
      error(err);
      error(err.stack);
      deferred.reject();
    });

    return deferred.promise;
  };

  var getMe = function (req, database) {
    var deferred = Q.defer();

    var basic = req.headers.authorization;
    var encoded = basic.substr(6);
    var decoded = new Buffer(encoded, 'base64').toString('utf-8');
    var firstColonIndex = decoded.indexOf(':');
    var username;

    if (firstColonIndex !== -1) {
      username = decoded.substr(0, firstColonIndex);
      if (knownIdentities[username]) {
        deferred.resolve(knownIdentities[username]);
      } else {
        identity(username, database).then(function (me) {
          knownIdentities[username] = me;
          deferred.resolve(me);
        }).fail(function (err) {
          error('Retrieving of identity had errors. Removing pg client from pool. Error : ');
          error(err);
          deferred.reject(err);
        });
      }
    }

    return deferred.promise;
  };

  var folderConfig = sri4nodeAttachments.configure(winston, {
    folder: '/tmp/inner-gerbil'
  });

  var s3config = sri4nodeAttachments.configure(winston, {
    s3key: process.env.S3_KEY, // eslint-disable-line
    s3secret: process.env.S3_SECRET, // eslint-disable-line
    s3bucket: process.env.S3_BUCKET, // eslint-disable-line
  });

  return {
    authenticate: $u.basicAuthentication(myAuthenticator),
    identify: getMe,

    logrequests: true,
    logsql: verbose,
    logdebug: verbose,
    defaultdatabaseurl: 'postgres://gerbil:inner@localhost:5432/postgres',
    description: '',
    resources: [
      require('./parties')(sri4node, winston, folderConfig, '/partiesFolder'),
      require('./parties')(sri4node, winston, s3config, '/partiesS3')
    ]
  };
};
