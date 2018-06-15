/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

chai.should();

const helper = require('../database/helper.js');
const db = require('../database/slideDatabase.js');
const deckdb = require('../database/deckDatabase');
const treedb = require('../database/deckTreeDatabase');

describe('slideDatabase', () => {

    before(() => {
        return helper.cleanDatabase();
    });

    after(() => {
        return helper.closeConnection();
    });


    context('when having an empty database', () => {
        it('should return nothing when requesting a non existant slide', () => {
            return db.get('asd7db2daasd').should.be.fulfilled.and.become(undefined);
        });


        it('should return the slide when inserting one', () => {
            let slide = {
                title: 'Dummy',
                content: 'dummy',
                language: 'en',
                license: 'CC0',
            };
            let res = db.insert(slide, 1);
            //res.then((data) => console.log('resolved', data));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.be.not.empty,
                res.should.eventually.include.all.keys('_id', 'language'),
                res.should.eventually.have.property('language', slide.language)
            ]);
        });

        it('should return the deck when inserting one', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };

            let res = deckdb.insert(deck, 1);
            //res.then((data) => console.log('resolved', data));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.be.not.empty,
                res.should.eventually.include.all.keys('_id', 'user')
            ]);
        });


        it('should get a previously inserted deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck, 1);
            let res = ins.then((ins) => deckdb.get(ins._id));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                // res.should.eventually.include.all.keys('_id', 'language'),
                res.should.eventually.have.property('user', 1)
            ]);
        });

        it('should get an previously inserted slide', () => {
            let slide = {
                title: 'Dummy',
                content: 'dummy',
                language: 'en',
                license: 'CC0',
            };
            let ins = db.insert(slide, 1);
            let res = ins.then((ins) => db.get(ins._id));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.include.all.keys('_id', 'language'),
                res.should.eventually.have.property('language', slide.language)
            ]);
        });

        it.skip('should be able to replace a previously inserted slide', () => {
            let slide = {
                title: 'Dummy',
                content: 'dummy',
                language: 'en',
                license: 'CC0',
            };
            let slide2 = {
                title: 'Dummy Replaced',
                content: 'dummy',
                language: 'en',
                license: 'CC0',
            };
            let ins = db.insert(slide, 1);
            let res = ins.then((ins) => db.revise(ins._id+'-1', slide2, 1));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.include.all.keys('id', 'revision'),
            ]);
        });

        it('should be able to replace an previously inserted deck without a new revision', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let deck2 = {
                'description': 'New Deck Replaced',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck, 1);
            let res = ins.then((ins) => deckdb.update(ins._id+'-1', deck2));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.include.all.keys('replaced', 'changed'),
                res.should.eventually.have.nested.property('replaced.revisions.0.language', deck.language),
            ]);
        });

        it('should copy an existing slide', () => {
            let slide = {
                title: 'Dummy',
                content: 'dummy',
                language: 'en',
                license: 'CC0',
            };
            let res = db.insert(slide, 1)
            .then((ins) => db.getSlideRevision(ins._id+'-1'))
            .then((original) => db.copy(original, '25-1', 1));
            //res.then((data) => console.log('resolved', data));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.include.all.keys('_id', 'language'),
                res.should.eventually.have.property('language', slide.language)
            ]);
        });

        it('should rename an existing slide', () => {
            let slide = {
                title: 'Dummy',
                content: 'dummy',
                language: 'en',
                license: 'CC0',
            };
            let ins = db.insert(slide, 1);
            let res = ins.then((ins) => db.rename(ins._id+'-1', 'new name' ));
            //res.then((data) => console.log('resolved', data));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
            ]);
        });

        it('should return the decktree of an existing deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck, 1);
            let res = ins.then((ins) => treedb.getDeckTree(ins._id+'-1'));
            //res.then((data) => console.log('resolved', data));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.property('title').that.is.not.empty,
                //res.should.eventually.have.all.keys('_id', 'user')
            ]);
        });

        it('should return the active revision of an existing deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck, 1);
            let res = ins.then((ins) => deckdb.getActiveRevisionFromDB(ins._id+'-1'));
            //res.then((data) => console.log('resolved', data));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                //res.should.eventually.have.all.keys('_id', 'user'),
            ]);
        });

        it('should rename an existing deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck, 1);
            let res = ins.then((ins) => deckdb.rename(ins._id+'-1', 'new name'));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
            ]);
        });

        it('should insert a content item into an existing deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck, 1);
            let res = ins.then((ins) => deckdb.insertNewContentItem({id: '1', revisions: [{},{},{user:2}]}, '2', ins._id+'-1', 'slide', '3'));
            return Promise.all([
                res.should.be.fulfilled
            ]);
        });

        it('should return flat decks of an existing deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck, 1);
            let res = ins.then((ins) => deckdb.getFlatDecks(ins._id+'-1'));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.property('title').that.is.not.empty,
            ]);
        });

        it('should return flat slides of an existing deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck, 1);
            let res = ins.then((ins) => treedb.getFlatSlides(ins._id+'-1'));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.property('title').that.is.not.empty,
            ]);
        });

        it('should return contributors of an existing deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck, 1);
            let res = ins.then((ins) => deckdb.getDeckContributors(ins._id+'-1'));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
            ]);
        });

        it('should fork an existing deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck, 1);
            let res = ins.then((ins) => treedb.copyDeckTree(ins._id+'-1', 1));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.property('root_deck').that.is.not.empty,
                res.should.eventually.have.property('id_map').that.is.not.empty,
            ]);
        });

    });
});
