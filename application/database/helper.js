/* eslint promise/always-return: "off" */
'use strict';

const Db = require('mongodb').Db,
    Server = require('mongodb').Server,
    MongoClient = require('mongodb').MongoClient,
    config = require('../configuration.js').MongoDB,
    co = require('../common');

let dbConnection = null;
let incrementationSettings = {
    collection: 'counters',
    field: '_id',
    step: 1
};

function testDbName(name) {
    return typeof name !== 'undefined' ? name : config.SLIDEWIKIDATABASE;
}

function testConnection(dbname) {
    if (!co.isEmpty(dbConnection)) { //TODO test for alive
        if (dbConnection.s.databaseName === dbname)
            return true;
        else {
            dbConnection.close();
            dbConnection = null;
            return false;
        }
    }
    return false;
}

//Uses extra collection for autoincrementation
// Code based on https://github.com/TheRoSS/mongodb-autoincrement
// requires document in collection "counters" like: { "_id" : "slides", "seq" : 1, "field" : "_id" } <- is created if not already existing
function getNextId(db, collectionName, fieldName) {
    const fieldNameCorrected = fieldName || incrementationSettings.field;
    const step = incrementationSettings.step;

    let myPromise = new Promise((resolve, reject) => {
        return db.collection(incrementationSettings.collection).findAndModify({
            _id: collectionName,
            field: fieldNameCorrected
        },
        null, //no sort
        {
            $inc: {
                seq: step
            }
        }, {
            upsert: true, //if there is a problem with _id insert will fail
            new: true //insert returns the updated document
        })
        .then((result) => {
            //console.log('getNextId: returned result', result);
            if (result.value && result.value.seq) {
                resolve(result.value.seq);
            } else {
                resolve(result.seq);
            }
        })
        .catch((error) => {
            //console.log('getNextId: ERROR', error);
            if (error.code === 11000) {
                //no distinct seq
                reject(error);
            } else {
                reject(error);
            }
        });
    });

    return myPromise;
}

let self = module.exports = {
    createDatabase: function(dbname) {
        dbname = testDbName(dbname);

        let myPromise = new Promise((resolve, reject) => {
            let db = new Db(dbname, new Server(config.HOST, config.PORT));
            db.open().then((connection) => {
                connection.collection('test').insertOne({ //insert the first object to know that the database is properly created TODO this is not real test....could fail without your knowledge
                    id: 1,
                    data: {}
                }, () => {
                    resolve(connection);
                });
            }).catch(reject);
        });

        return myPromise;
    },

    cleanDatabase: function(dbname) {
        dbname = testDbName(dbname);

        return this.connectToDatabase(dbname)
        .then((db) => {
            const DatabaseCleaner = require('database-cleaner');
            const databaseCleaner = new DatabaseCleaner('mongodb');
            return new Promise((resolve) => databaseCleaner.clean(db, resolve));
        }).catch((error) => {
            throw error;
        });
    },

    connectToDatabase: function(dbname) {
        dbname = testDbName(dbname);

        if (testConnection(dbname)) {
            return Promise.resolve(dbConnection);
        } else {
            return MongoClient.connect('mongodb://' + config.HOST + ':' + config.PORT + '/' + dbname)
            .then((db) => {
                if (db.s.databaseName !== dbname)
                    throw new 'Wrong Database!';

                // log connection status and reset connection once reconnect fails
                db.on('close', (err) => {
                    if (err) {
                        console.warn(err.message);
                    }
                });
                db.on('reconnect', (payload) => {
                    console.warn(payload ? `reconnected to ${payload.s.host}:${payload.s.port}`: 'reconnected to mongodb');
                });
                // HACK This is an undocumented event name, but it's there and it works
                // best solution so far, and even if it's removed in the future, it will not break anything else
                // (it will just not do what we'd like to do)
                db.on('reconnectFailed', (err) => {
                    console.warn(err.message);
                    // connection is useless now, let's remove it and let the service retry getting a new one
                    dbConnection = null;
                });

                dbConnection = db;
                return db;
            }).catch((err) => {
                // if we can't get a connection we should just exit!
                console.error(err.message);
                process.exit(-1);
            });
        }
    },

    getCollection: function(name) {
        return self.connectToDatabase().then((db) => db.collection(name));
    },

    getNextIncrementationValueForCollection: function (dbconn, collectionName, fieldName) {
        return getNextId(dbconn, collectionName, fieldName);
    },

    applyFixtures: function(db, data) {
        let async = require('async');
        let names = Object.keys(data.collections);

        return new Promise((resolve) => {
            async.eachSeries(names, (name, cb) => {
                db.createCollection(name, (err, collection) => {
                    if (err) return cb(err);
                    // console.log(data.collections[name].length);
                    collection.insert(data.collections[name], cb);
                });
            }, resolve);
        });
    },

};
