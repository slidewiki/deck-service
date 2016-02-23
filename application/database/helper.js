'use strict';

const Db = require('mongodb').Db,
  Server = require('mongodb').Server,
  MongoClient = require('mongodb').MongoClient,
  config = require('../configuration.js').MongoDB,
  co = require('../common');

let dbConnection = undefined;

function _connectToDatabase(dbname, resolve, reject) {
  dbname = typeof dbname !== 'undefined' ? dbname : config.SLIDEWIKIDATABASE;

  testConnection(dbname, resolve);

  MongoClient.connect('mongodb://' + config.HOST + ':' + config.PORT + '/' + dbname, (error, db) => {
    if (error) {
      reject(error);
    } else {
      if (db.s.databaseName !== dbname) {
        throw new 'Wrong Database!';
      }
      dbConnection = db;
      return resolve(db);
    }
  });
}

function testConnection(dbname, resolve) {
  if (!co.isEmpty(dbConnection)) { //TODO test for alive
    if (dbConnection.s.databaseName === dbname)
      resolve(dbConnection);
    else {
      dbConnection.close();
      dbConnection = undefined;
    }
  }
}

function _createDatabase(dbname, resolve, reject) {
  dbname = typeof dbname !== 'undefined' ? dbname : config.SLIDEWIKIDATABASE;

  let db = new Db(dbname,
    new Server(config.HOST,
      config.PORT));
  db.open((error, db) => {
    if (error)
      reject(error);
    else {
      //insert the first object to know that the database is properly created
      db.collection('test').insertOne({
        id: 1,
        data: {}
      });
      resolve(db);
    }
  });
}

function _dropDatabase(db, resolve, reject) {
  try {
    const DatabaseCleaner = require('database-cleaner');
    const databaseCleaner = new DatabaseCleaner('mongodb');

    databaseCleaner.clean(db, resolve);
  } catch (error) {
    reject(error);
  }
}

module.exports = {
  createDatabase: function(dbname) {
    return new Promise((resolve, reject) => {
      _createDatabase(dbname, resolve, reject);
    });
  },

  cleanDatabase: function(db, dbname) {
    return new Promise((resolve, reject) => {
      //use db connection or database name
      if (db)
        _dropDatabase(db, resolve, reject);
      else {
        module.exports.connectToDatabase(dbname)
          .then((db2) => {
            _dropDatabase(db2, resolve, reject);
          })
          .catch((error) => {
            reject(error);
          });
      }
    });
  },

  connectToDatabase: function(dbname) {
    return new Promise((resolve, reject) => {
      _connectToDatabase(dbname, resolve, reject);
    });
  }
};
