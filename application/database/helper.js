'use strict';

const Db = require('mongodb').Db,
  Server = require('mongodb').Server,
  MongoClient = require('mongodb').MongoClient,
  config = require('../configuration.js').MongoDB;

function testDbName(name) {
  return typeof name !== 'undefined' ? name : config.SLIDEWIKIDATABASE;
}

module.exports = {
  createDatabase: function(dbname) {
    dbname = testDbName(dbname);

    let db = new Db(dbname, new Server(config.HOST, config.PORT));
    return db.open().then((db) => {
      db.collection('test').insertOne({ //insert the first object to know that the database is properly created TODO this is not real test....could fail without your knowledge
        id: 1,
        data: {}
      });
      return db
    });
  },

  cleanDatabase: function(db, dbname) {
    this.connectToDatabase(dbname)
      .then((db2) => {
        const DatabaseCleaner = require('database-cleaner');
        const databaseCleaner = new DatabaseCleaner('mongodb');

        return databaseCleaner.clean(db, resolve);
      });
  },

  connectToDatabase: function(dbname) {
    dbname = testDbName(dbname);

    return MongoClient.connect('mongodb://' + config.HOST + ':' + config.PORT + '/' + dbname)
      .then((db) => {
        if (db.s.databaseName !== dbname)
          throw new 'Wrong Database!';
        return db;
      });
  }
};
