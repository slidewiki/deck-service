/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

let chai = require('chai');
chai.use(require('chai-as-promised'));
let should = chai.should();

let helper = require('../database/helper.js');
let deckDB = require('../database/deckDatabase');
let controller = require('../controllers/handler');

describe('deck delete module', function() {

    beforeEach(function() {
        return helper.cleanDatabase().then(() =>
            helper.connectToDatabase().then((db) =>
                helper.applyFixtures(db, require('./fixtures/deck_delete.json'))
            )
        );
    });

    describe('deckDatabase.getDeckTreeOwners()', function() {

        it('should return nothing for non-existent deck ids', function() {
            return deckDB.getDeckTreeOwners(1).then((deckTreeOwners) => {
                should.not.exist(deckTreeOwners);
            });
        });

        it('should return all subdeck owners including for the root deck for a deck tree', function() {
            return deckDB.getDeckTreeOwners(2272).then((deckTreeOwners) => {
                deckTreeOwners.should.be.an('array');
                deckTreeOwners.should.have.length.of(2);
                deckTreeOwners.forEach((owner) => {
                    owner.should.have.a.property('_id');
                    owner.should.have.a.property('deckIds').that.is.an('array');
                });
            });
        });

    });

    describe('handlers.deleteDeckTree()', function() {

        it('should be able to delete a root deck tree where owner is common in all subdecks', function(done) {
            controller.deleteDeckTree({
                params: {id: 2277},
                auth: {credentials: {userid: 46}},
                log: console.log.bind(console),
            }, (result) => {
                try {
                    should.not.exist(result);
                    done();
                } catch (e) {
                    done(e);
                }
            });
        });

        it('should not be able to delete a deck tree that the user does not own', function(done) {
            controller.deleteDeckTree({
                params: {id: 2277},
                auth: {credentials: {userid: 48}},
                log: console.log.bind(console),
            }, (result) => {
                try {
                    result.should.have.deep.property('output.statusCode', 403);
                    done();
                } catch (e) {
                    done(e);
                }
            });
        });

        it('should not be able to delete a deck tree that is not root', function(done) {
            controller.deleteDeckTree({
                params: {id: 2276},
                auth: {credentials: {userid: 46}},
                log: console.log.bind(console),
            }, (result) => {
                try {
                    result.should.have.deep.property('output.statusCode', 409);
                    done();
                } catch (e) {
                    done(e);
                }
            });
        });

        it('should not be able to delete a root deck tree where owner is NOT common in all subdecks', function(done) {
            controller.deleteDeckTree({
                params: {id: 2272},
                auth: {credentials: {userid: 46}},
                log: console.log.bind(console),
            }, (result) => {
                try {
                    result.should.have.deep.property('output.statusCode', 409);
                    done();
                } catch (e) {
                    done(e);
                }
            });

        });

        it('should return not found error when deck id is missing/unknown', function(done) {
            controller.deleteDeckTree({
                params: {id: 666},
                auth: {credentials: {userid: 1}},
                log: console.log.bind(console),
            }, (result) => {
                try {
                    result.should.have.deep.property('output.statusCode', 404);
                    done();
                } catch (e) {
                    done(e);
                }
            });

        });

    });

});
