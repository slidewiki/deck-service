/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

const chai = require('chai');
chai.should();

describe('REST API deck tree', () => {

    const qs = require('querystring');

    const util = require('../lib/util');
    const testServer = require('../testServer');

    let authToken = testServer.tokenFor(1);
    let server;

    before(async () => {
        server = await testServer.init();
        return server.start();
    });

    after(async () => {
        return server && server.stop();
    });

    let deckId, slideIds = [];
    let originalTitle = 'The root for deck tree tests';
    it('should create a new deck', async () => {
        let theme = 'sky';
        let response = await server.inject({
            method: 'POST',
            url: '/deck/new',
            payload: {
                title: originalTitle,
                theme,
                language: 'en',
                first_slide: {
                    title: String(0),
                },
            },
            headers: {
                '----jwt----': authToken,
            },
        });
        response.statusCode.should.equal(200);
        response.result.should.contain.keys('id', 'revisions');
        response.result.revisions.should.be.an('array').of.length(1);

        deckId = response.result.id;

        // read the deck tree
        response = await server.inject(`/decktree/${deckId}`);
        response.statusCode.should.equal(200);
        response.result.should.have.property('type', 'deck');
        response.result.should.have.property('id', `${deckId}-1`);
        response.result.should.have.property('title', originalTitle);
        response.result.should.have.property('theme', theme);
        response.result.should.have.property('children').that.is.an('array').of.length(1);

        response.result.children[0].should.include.keys('id', 'type', 'title');
        response.result.children[0].title.should.equal(String(0));
        slideIds.push(response.result.children[0].id);
    });

    it('should append some slides', async () => {
        // add some slides
        for (let i = 0; i < 4; i++) {
            let response = await server.inject({
                method: 'POST',
                url: '/decktree/node/create',
                payload: {
                    selector: {
                        id: String(deckId),
                        spath: '',
                    },
                    nodeSpec: {
                        type: 'slide',
                    },
                    title: String(i + 1),
                },
                headers: {
                    '----jwt----': authToken,
                },
            });
            response.statusCode.should.equal(200);

            response.result.should.have.keys('id', 'type', 'title');
            response.result.type.should.equal('slide');
            response.result.title.should.equal(String(i + 1));

            slideIds.push(response.result.id);
        }

        // read the deck tree
        let response = await server.inject(`/decktree/${deckId}`);
        response.statusCode.should.equal(200);
        response.result.should.have.property('type', 'deck');
        response.result.should.have.property('children').that.is.an('array').of.length(5);

        // children are in ascending order 
        response.result.children.forEach((c, i) => {
            c.should.include.keys('id', 'type', 'title');
            c.id.should.equal(slideIds[i]);
            c.title.should.equal(String(i));
        });
    });

    it.skip('should prepend a slide (not supported!)', async () => {
        let response = await server.inject({
            method: 'POST',
            url: '/decktree/node/create',
            payload: {
                selector: {
                    id: String(deckId),
                    spath: ':0',
                },
                nodeSpec: {
                    type: 'slide',
                },
                title: 'Extra slide',
            },
            headers: {
                '----jwt----': authToken,
            },
        });
        response.statusCode.should.equal(200);
        response.result.should.have.keys('id', 'type', 'title');
        let slideId = response.result.id;

        // read the deck tree
        response = await server.inject(`/decktree/${deckId}`);
        response.statusCode.should.equal(200);
        response.result.should.have.property('children').that.is.an('array').of.length(6);

        // children are in ascending order 
        response.result.children[0].should.include.keys('id', 'type', 'title');
        response.result.children[0].id.should.equal(slideId);
        response.result.children[0].title.should.equal('Extra slide');
    });

    it('should insert a slide after a tree node', async () => {
        let response = await server.inject({
            method: 'POST',
            url: '/decktree/node/create',
            payload: {
                selector: {
                    id: String(deckId),
                    spath: '',
                    stype: 'slide',
                    sid: slideIds[3],
                },
                nodeSpec: {
                    type: 'slide',
                },
                title: 'Extra slide',
            },
            headers: {
                '----jwt----': authToken,
            },
        });
        response.statusCode.should.equal(200);
        response.result.should.have.keys('id', 'type', 'title');
        let slideId = response.result.id;

        // read the deck tree
        response = await server.inject(`/decktree/${deckId}`);
        response.statusCode.should.equal(200);
        response.result.should.have.property('children').that.is.an('array').of.length(6);

        // new slide is after the one in selector
        response.result.children[4].should.include.keys('id', 'type', 'title');
        response.result.children[4].id.should.equal(slideId);
        response.result.children[4].title.should.equal('Extra slide');
    });

    it('should append a subdeck', async () => {
        let response = await server.inject({
            method: 'POST',
            url: '/decktree/node/create',
            payload: {
                selector: {
                    id: String(deckId),
                    spath: '',
                },
                nodeSpec: {
                    type: 'deck',
                },
                title: 'Slide in subdeck',
            },
            headers: {
                '----jwt----': authToken,
            },
        });
        response.statusCode.should.equal(200);
        response.result.should.include.keys('id', 'type', 'title', 'children');
        response.result.type.should.equal('deck');
        // TODO fix this
        response.result.title.should.equal('New deck');
        let subdeckId = response.result.id;

        // read the deck tree
        response = await server.inject(`/decktree/${deckId}`);
        response.statusCode.should.equal(200);
        response.result.should.have.property('children').that.is.an('array').of.length(7);

        // new deck is last
        let [subdeck] = response.result.children.slice(-1);
        subdeck.should.include.keys('id', 'type', 'title');
        subdeck.id.should.equal(subdeckId);
        subdeck.title.should.equal('New deck');

        subdeck.should.have.property('children').that.is.an('array').of.length(1);
        subdeck.children[0].should.have.property('title', 'Slide in subdeck');
    });

    let subdeckId;
    it('should insert a subdeck after some node', async () => {
        let response = await server.inject({
            method: 'POST',
            url: '/decktree/node/create',
            payload: {
                selector: {
                    id: String(deckId),
                    spath: '',
                    stype: 'slide',
                    sid: slideIds[2],
                },
                nodeSpec: {
                    type: 'deck',
                },
                title: 'Slide in another subdeck',
            },
            headers: {
                '----jwt----': authToken,
            },
        });
        response.statusCode.should.equal(200);
        response.result.should.include.keys('id', 'type', 'title', 'children');
        subdeckId = response.result.id;

        // read the deck tree
        response = await server.inject(`/decktree/${deckId}`);
        response.statusCode.should.equal(200);
        response.result.should.have.property('children').that.is.an('array').of.length(8);

        // new deck after 2
        let subdeck = response.result.children[3];
        subdeck.should.have.property('id', subdeckId);
        subdeck.should.have.property('children').that.is.an('array').of.length(1);
        subdeck.children[0].should.have.property('title', 'Slide in another subdeck');
    });

    it('can create a deck translation', async () => {
        let response = await server.inject({
            method: 'POST',
            url: `/deck/${deckId}/translations`,
            payload: {
                language: 'el',
            },
            headers: {
                '----jwt----': authToken,
            },
        });
        response.statusCode.should.equal(200);

        // read the translations
        response = await server.inject(`/deck/${deckId}/translations`);
        response.statusCode.should.equal(200);
        response.result.should.have.deep.members([
            { language: 'el' },
        ]);

        // read the translations of the subdeck, should not have any new ones (no propagation)
        response = await server.inject(`/deck/${subdeckId}/translations`);
        response.statusCode.should.equal(200);
        response.result.should.be.an('array').of.length(0);

        // read the deck tree, should include both original and translation
        response = await server.inject(`/decktree/${deckId}`);
        response.statusCode.should.equal(200);
        response.result.should.have.property('variants').that.has.deep.members([
            { language: 'en', original: true, title: originalTitle },
            { language: 'el' },
        ]);
    });

    it('can rename a deck tree subdeck for a translation', async () => {
        let response = await server.inject({
            method: 'PUT',
            url: '/decktree/node/rename',
            payload: {
                language: 'el',
                selector: {
                    id: String(deckId),
                    spath: '',
                    stype: 'deck',
                    sid: subdeckId,
                },
                name: 'Μια παρουσίαση στα ελληνικά',
            },
            headers: {
                '----jwt----': authToken,
            },
        });
        response.statusCode.should.equal(200);

        // read the deck tree
        response = await server.inject(`/decktree/${subdeckId}`);
        response.statusCode.should.equal(200);
        response.result.should.have.property('title', 'New deck');
        response.result.should.have.property('language', 'en');
        response.result.should.have.property('variants').that.includes.deep.members([
            { language: 'en', title: 'New deck', original: true },
            { language: 'el', title: 'Μια παρουσίαση στα ελληνικά' },
        ]);

        // read the translated deck tree
        response = await server.inject(`/decktree/${subdeckId}?language=el`);
        response.statusCode.should.equal(200);
        response.result.should.have.property('title', 'Μια παρουσίαση στα ελληνικά');
        response.result.should.have.property('language', 'el');
        response.result.should.have.property('variants').that.has.deep.members([
            { language: 'en', title: 'New deck', original: true },
            { language: 'el', title: 'Μια παρουσίαση στα ελληνικά' },
        ]);

        // read the translations of the subdeck
        response = await server.inject(`/deck/${subdeckId}/translations`);
        response.statusCode.should.equal(200);
        response.result.should.have.deep.members([
            { language: 'el', title: 'Μια παρουσίαση στα ελληνικά' },
        ]);

    });

    it('can rename a deck tree subdeck for a language not in the translations, and automatically add it to subdeck only', async () => {
        let language = 'de';
        let title = 'Eine Präsentation auf Deutsch';
        let response = await server.inject({
            method: 'PUT',
            url: '/decktree/node/rename',
            payload: {
                language,
                selector: {
                    id: String(deckId),
                    spath: '',
                    stype: 'deck',
                    sid: subdeckId,
                },
                name: title,
            },
            headers: {
                '----jwt----': authToken,
            },
        });
        response.statusCode.should.equal(200);

        // read the deck tree
        response = await server.inject(`/decktree/${subdeckId}`);
        response.statusCode.should.equal(200);
        response.result.should.have.property('title', 'New deck');
        response.result.should.have.property('language', 'en');
        response.result.should.have.property('variants').that.includes.deep.members([
            { language, title },
        ]);

        // read the translated deck tree
        response = await server.inject(`/decktree/${subdeckId}?language=${language}`);
        response.statusCode.should.equal(200);
        response.result.should.have.property('title', title);
        response.result.should.have.property('language', language);
        response.result.should.have.property('variants').that.includes.deep.members([
            { language, title },
        ]);

        // read the translations of the subdeck
        response = await server.inject(`/deck/${subdeckId}/translations`);
        response.statusCode.should.equal(200);
        response.result.should.include.deep.members([
            { language, title },
        ]);

        // read the translations of the parent deck
        response = await server.inject(`/deck/${deckId}/translations`);
        response.statusCode.should.equal(200);
        response.result.should.be.an('array');
        response.result.should.all.satisfy((t) => t.language !== language);
    });

    it('can set the translated title of a deck tree slide', async () => {
        let response = await server.inject({
            method: 'PUT',
            url: '/decktree/node/rename',
            payload: {
                language: 'el',
                selector: {
                    id: String(deckId),
                    spath: '',
                    stype: 'slide',
                    sid: slideIds[0],
                },
                name: 'Μηδέν',
            },
            headers: {
                '----jwt----': authToken,
            },
        });
        response.statusCode.should.equal(200);

        // read the deck tree
        response = await server.inject(`/decktree/${deckId}`);
        let slide = response.result.children[0];
        slide.should.have.property('language', 'en');
        slide.should.have.property('title', String(0));

        // read the translated deck tree
        response = await server.inject(`/decktree/${deckId}?language=el`);
        let translatedSlide = response.result.children[0];
        translatedSlide.should.have.property('language', 'el');
        translatedSlide.should.have.property('title', 'Μηδέν');

        // read the translations of the slide node
        response = await server.inject('/decktree/node/translations?' + qs.stringify({
            id: deckId,
            stype: 'slide',
            sid: slideIds[0],
        }));
        response.result.should.be.an('array').of.length(1);
        response.result[0].should.have.property('language', 'el');
        util.toIdentifier(response.result[0]).should.equal(translatedSlide.id);

        // check usage of both slides
        response = await server.inject(`/slide/${slide.id}`);
        response.result.revisions[0].usage.should.have.deep.members([
            { id: deckId, revision: 1 },
        ]);
        response = await server.inject(`/slide/${translatedSlide.id}`);
        response.result.revisions[0].usage.should.have.deep.members([
            { id: deckId, revision: 1 },
        ]);
    });

    it('can move all translations of a deck tree slide', async () => {
        let response = await server.inject({
            method: 'PUT',
            url: '/decktree/node/move',
            payload: {
                sourceSelector: {
                    id: String(deckId),
                    spath: '',
                    stype: 'slide',
                    sid: slideIds[0],
                },
                targetSelector: {
                    id: String(deckId),
                },
                targetIndex: 4,
            },
            headers: {
                '----jwt----': authToken,
            },
        });
        response.statusCode.should.equal(200);

        // read the deck tree
        response = await server.inject(`/decktree/${deckId}`);
        let slide = response.result.children[4];
        slide.should.have.property('language', 'en');
        slide.should.have.property('title', String(0));

        // read the translated deck tree
        response = await server.inject(`/decktree/${deckId}?language=el`);
        let translatedSlide = response.result.children[4];
        translatedSlide.should.have.property('language', 'el');
        translatedSlide.should.have.property('title', 'Μηδέν');

        // read the translations of the slide node
        response = await server.inject('/decktree/node/translations?' + qs.stringify({
            id: deckId,
            stype: 'slide',
            sid: slideIds[0],
        }));
        response.result.should.be.an('array').of.length(1);
        response.result[0].should.have.property('language', 'el');
        util.toIdentifier(response.result[0]).should.equal(translatedSlide.id);

        // check usage of both slides
        response = await server.inject(`/slide/${slide.id}`);
        response.result.revisions[0].usage.should.have.deep.members([
            { id: deckId, revision: 1 },
        ]);
        response = await server.inject(`/slide/${translatedSlide.id}`);
        response.result.revisions[0].usage.should.have.deep.members([
            { id: deckId, revision: 1 },
        ]);
    });

    it('can rename a deck tree slide translation', async () => {
        let response = await server.inject({
            method: 'PUT',
            url: '/decktree/node/rename',
            payload: {
                language: 'el',
                selector: {
                    id: String(deckId),
                    spath: '',
                    stype: 'slide',
                    sid: slideIds[0],
                },
                name: 'Μηδέν ξανά',
            },
            headers: {
                '----jwt----': authToken,
            },
        });
        response.statusCode.should.equal(200);

        // read the deck tree
        response = await server.inject(`/decktree/${deckId}`);
        let slide = response.result.children[4];
        let slideRef = util.parseIdentifier(slide.id);
        slideRef.revision.should.equal(1);

        // read the translated deck tree
        response = await server.inject(`/decktree/${deckId}?language=el`);
        let translatedSlide = response.result.children[4];
        translatedSlide.title.should.equal('Μηδέν ξανά');

        let translatedRef = util.parseIdentifier(translatedSlide.id);
        translatedRef.revision.should.equal(2);

        // check usage of the older translation
        response = await server.inject(`/slide/${translatedRef.id}-1`);
        response.result.revisions[0].usage.should.be.an('array').of.length(0);
    });

    it('can rename the primary language of a deck tree slide translation', async () => {
        let response = await server.inject({
            method: 'PUT',
            url: '/decktree/node/rename',
            payload: {
                selector: {
                    id: String(deckId),
                    spath: '',
                    stype: 'slide',
                    sid: slideIds[0],
                },
                name: 'Zero',
            },
            headers: {
                '----jwt----': authToken,
            },
        });
        response.statusCode.should.equal(200);

        // read the deck tree
        response = await server.inject(`/decktree/${deckId}`);
        let slide = response.result.children[4];
        let slideRef = util.parseIdentifier(slide.id);
        slideRef.revision.should.equal(2);
        slide.title.should.equal('Zero');

        // read the translated deck tree
        response = await server.inject(`/decktree/${deckId}?language=el`);
        let translatedSlide = response.result.children[4];
        translatedSlide.title.should.equal('Μηδέν ξανά');

        let translatedRef = util.parseIdentifier(translatedSlide.id);
        translatedRef.revision.should.equal(2);

        // check usage of the older primary slide
        response = await server.inject(`/slide/${slideRef.id}-1`);
        response.result.revisions[0].usage.should.be.an('array').of.length(0);
    });

    it('can move all translations of a deck tree slide into a subdeck', async () => {
        let response = await server.inject({
            method: 'PUT',
            url: '/decktree/node/move',
            payload: {
                sourceSelector: {
                    id: String(deckId),
                    spath: '',
                    stype: 'slide',
                    sid: slideIds[0],
                },
                targetSelector: {
                    id: String(deckId),
                    stype: 'deck',
                    sid: subdeckId,
                },
                targetIndex: 0,
            },
            headers: {
                '----jwt----': authToken,
            },
        });
        response.statusCode.should.equal(200);

        // read the deck tree
        response = await server.inject(`/decktree/${subdeckId}`);
        let slide = response.result.children[0];
        slide.should.have.property('language', 'en');
        slide.should.have.property('title', 'Zero');

        // read the translated deck tree
        response = await server.inject(`/decktree/${subdeckId}?language=el`);
        let translatedSlide = response.result.children[0];
        translatedSlide.should.have.property('language', 'el');
        translatedSlide.should.have.property('title', 'Μηδέν ξανά');

        // read the translations of the slide node
        response = await server.inject('/decktree/node/translations?' + qs.stringify({
            id: deckId,
            stype: 'slide',
            sid: slideIds[0],
        }));
        response.result.should.be.an('array').of.length(1);
        response.result[0].should.have.property('language', 'el');
        util.toIdentifier(response.result[0]).should.equal(translatedSlide.id);

        let subdeck = util.parseIdentifier(subdeckId);
        // check usage of both slides
        response = await server.inject(`/slide/${slide.id}`);
        response.result.revisions[0].usage.should.have.deep.members([
            subdeck,
        ]);
        response = await server.inject(`/slide/${translatedSlide.id}`);
        response.result.revisions[0].usage.should.have.deep.members([
            subdeck,
        ]);
    });

    it('should not be able to change deck primary language, but it should add a deck translation instead', async () => {
        let language = 'de';
        let title = 'Die Wurzel für Deckbaumtests';
        let description = 'Auf Deutsch, bitte!';
        let response = await server.inject({
            method: 'PUT',
            url: `/deck/${deckId}`,
            payload: {
                language,
                title,
                description,
            },
            headers: {
                '----jwt----': authToken,
            },
        });
        response.statusCode.should.equal(200);
        response.result.should.have.nested.property('revisions.0.language', 'en');

        response = await server.inject(`/deck/${deckId}/translations`);
        response.statusCode.should.equal(200);

        response.result.should.be.an('array').that.includes.deep.members([
            { language, title, description },
        ]);

    });

});
