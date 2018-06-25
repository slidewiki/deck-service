/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
/* eslint promise/no-callback-in-promise: "off" */
'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

chai.should();

const helper = require('../database/helper.js');

describe('Database Helper', () => {
    let tempDatabase = 'AwesomeMoo3000';

    beforeEach(() => {
        return helper.cleanDatabase(tempDatabase);
    });

    after(() => {
        return helper.closeConnection();
    });


    context('when connecting to an existing database', () => {
        it('should return the correct connection object', () => {

            let db = helper.connectToDatabase('local');
            return Promise.all([
                db.should.be.fulfilled,
                db.should.eventually.not.be.empty,
                db.should.eventually.have.property('s').that.is.not.empty,
                db.should.eventually.have.property('s').that.has.property('databaseName', 'local')
            ]);
        });

        it('should be possible to call cleanup', () => {
            return helper.cleanDatabase('local').should.be.fulfilled;
        });
    });

    context('when connecting to a not existing database', () => {
        it('should be an empty database', () => {
            let col = helper.connectToDatabase('AwesomeMoo2000').then((db) => db.collections());
            return Promise.all([
                col.should.be.fulfilled,
                col.should.eventually.have.property('length', 0)
            ]);
        });
    });

    context('when creating a new database', () => {
        it('should contain only one collection with one object', () => {
            return helper.createDatabase(tempDatabase).then((db) => Promise.all([
                db.collections.should.have.property('length', 1),
                db.collection('test').count().should.eventually.not.equal(0)
            ]));
        });
    });
});
