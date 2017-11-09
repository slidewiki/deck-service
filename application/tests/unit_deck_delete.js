/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

let chai, should;

let helper = require('../database/helper.js');
let deckDB = require('../database/deckDatabase');
let controller = require('../controllers/handler');

// helper function to make a promise out of a handler function
function handlerPromise(handler, request) {
    Object.assign(request, { log: console.log.bind(console) });
    return new Promise((resolve, reject) => {
        try {
            handler(request, (result) => {
                resolve(result);
            });
        } catch (e) {
            reject(e);
        }
    });
}

describe('deck delete module', function() {

    before(function(done) {
        Object.keys(require.cache).forEach((key) => delete require.cache[key]);

        chai = require('chai');
        chai.use(require('chai-as-promised'));
        chai.use(require('chai-things'));
        should = chai.should();

        done();
    });

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

    describe('handlers.deleteDeck()', function() {

        it('should be able to delete a root deck and keep any subdecks', function() {
            return handlerPromise(controller.deleteDeck, {
                params: {id: 2272},
                auth: {credentials: {userid: 46}},
            }).then((result) => {
                should.not.exist(result);

                return Promise.all([
                    handlerPromise(controller.getDeck, {
                        params: {id: '2273'},
                    }).then((subdeck) => {
                        subdeck.should.have.property('_id', 2273);
                        subdeck.should.have.property('revisions').that.is.an('array').and.is.not.empty;
                        subdeck.revisions[0].should.have.property('usage').that.not.includes.something.with.property('id', 2272);
                    }),
                    handlerPromise(controller.getDeck, {
                        params: {id: '2274'},
                    }).then((subdeck) => {
                        subdeck.should.have.property('_id', 2274);
                        subdeck.should.have.property('revisions').that.is.an('array').and.is.not.empty;
                        subdeck.revisions[0].should.have.property('usage').that.not.includes.something.with.property('id', 2272);
                    }),
                    handlerPromise(controller.getSlide, {
                        params: {id: '15016'},
                    }).then((subdeck) => {
                        subdeck.should.have.property('_id', 15016);
                        subdeck.should.have.property('revisions').that.is.an('array').and.is.not.empty;
                        subdeck.revisions.forEach((rev) => {
                            rev.should.have.property('usage').that.not.includes.something.with.property('id', 2272);
                        });
                    }),
                ]);

            });
        });

        it('should not be able to delete a deck that the user does not own', function() {
            return handlerPromise(controller.deleteDeck, {
                params: {id: 2272},
                auth: {credentials: {userid: 48}},
            }).then((result) => {
                result.should.have.deep.property('output.statusCode', 403);
            });
        });

        it('should not be able to delete a deck that is not root', function() {
            return handlerPromise(controller.deleteDeck, {
                params: {id: 2276},
                auth: {credentials: {userid: 46}},
            }).then((result) => {
                result.should.have.deep.property('output.statusCode', 409);
            });
        });

        it('should return not found error when deck id is missing/unknown', function() {
            return handlerPromise(controller.deleteDeck, {
                params: {id: 666},
                auth: {credentials: {userid: 1}},
            }).then((result) => {
                result.should.have.deep.property('output.statusCode', 404);
            });
        });

    });

    describe('handlers.deleteDeckTree()', function() {

        it('should be able to delete a root deck tree where owner is common in all subdecks', function() {
            return handlerPromise(controller.deleteDeckTree, {
                params: {id: 2277},
                auth: {credentials: {userid: 46}},
            }).then((result) => {
                should.not.exist(result);

                return handlerPromise(controller.getDeck, {
                    params: {id: '2275'},
                }).then((notFound) => {
                    notFound.should.have.deep.property('output.statusCode', 404);

                    return handlerPromise(controller.getDeck, {
                        params: {id: '2276'},
                    }).then((notFound) => {
                        notFound.should.have.deep.property('output.statusCode', 404);
                    });
                });
            });
        });

        it('should not be able to delete a deck tree that the user does not own', function() {
            return handlerPromise(controller.deleteDeckTree, {
                params: {id: 2277},
                auth: {credentials: {userid: 48}},
            }).then((result) => {
                result.should.have.deep.property('output.statusCode', 403);
            });
        });

        it('should not be able to delete a deck tree that is not root', function() {
            return handlerPromise(controller.deleteDeckTree, {
                params: {id: 2276},
                auth: {credentials: {userid: 46}},
            }).then((result) => {
                result.should.have.deep.property('output.statusCode', 409);
            });
        });

        it('should not be able to delete a root deck tree where owner is NOT common in all subdecks', function() {
            return handlerPromise(controller.deleteDeckTree, {
                params: {id: 2272},
                auth: {credentials: {userid: 46}},
                log: console.log.bind(console),
            }).then((result) => {
                result.should.have.deep.property('output.statusCode', 409);
            });
        });

        it('should return not found error when deck id is missing/unknown', function() {
            return handlerPromise(controller.deleteDeckTree, {
                params: {id: 666},
                auth: {credentials: {userid: 1}},
                log: console.log.bind(console),
            }).then((result) => {
                result.should.have.deep.property('output.statusCode', 404);
            });
        });

    });

});
