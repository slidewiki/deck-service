/*
Handles the requests by executing stuff and replying to the client. Uses promises to get stuff done.
*/



'use strict';

const _ = require('lodash');
const util = require('../lib/util');

const boom = require('boom'),
    slideDB = require('../database/slideDatabase'),
    deckDB = require('../database/deckDatabase'),
    co = require('../common'),
    Joi = require('joi'),
    async = require('async');

// TODO remove this from here after we've refactored all database-specific code into slide/deck database js files
const ChangeLog = require('../lib/ChangeLog');

const userService = require('../services/user');
const tagService = require('../services/tag');
const fileService = require('../services/file');

const slidetemplate = '<div class="pptx2html" style="position: relative; width: 960px; height: 720px;">'+

    '<div _id="2" _idx="undefined" _name="Title 1" _type="title" class="block content v-mid h-mid" style="position: absolute; top: 38.3334px; left: 66px; width: 828px; height: 139.167px; z-index: 23488;">'+
    '<h3>Title</h3></div>'+
    '<div _id="3" _idx="1" _name="Content Placeholder 2" _type="body" class="block content v-up" style="position: absolute; top: 191.667px; left: 66px; width: 828px; height: 456.833px; z-index: 23520;">'+
    '<ul>'+
    '	<li>Text bullet 1</li>'+
    '	<li>Text bullet 2</li>'+
    '</ul>'+
    '<div class="h-left">&nbsp;</div>'+
    '</div></div>';

let self = module.exports = {
    //returns a news ID of a legacy deck (with the revision number fort the user owning the legacy revision)
    getLegacyDeckId: function(request, reply) {
        deckDB.getLegacyId(request.params.oldId).then((id) => {
            if (co.isEmpty(id))
                reply(boom.notFound());
            else
                reply(id);
        }).catch((error) => {
            reply(error);
        });
    },

    //gets a single slide with all of its revisions, unless revision is defined
    getSlide: function(request, reply) {
        slideDB.get(encodeURIComponent(request.params.id)).then((slide) => {
            if (co.isEmpty(slide))
                reply(boom.notFound());
            else
                reply(slide);
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    //Get All Slides from database
    getAllSlides: function(request, reply) {
        slideDB.getAllFromCollection()
        .then((slides) => {
            slides.forEach((slide) => {
                co.rewriteID(slide);
            });

            let jsonReply = JSON.stringify(slides);
            reply(jsonReply);

        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    //inserts a new slide into the database
    newSlide: function(request, reply) {
        let userId = request.auth.credentials.userid;

        self._newSlide(request.payload, userId, request)
        .then(reply)
        .catch((error) => {
            if (error.isBoom) return reply(error);

            request.log('error', error);
            reply(boom.badImplementation());
        });

    },

    // reusable version of newSlide
    _newSlide: function(payload, userId, logger) {
        // make sure user id is set
        payload.user = userId;

        // insert the slide
        return slideDB.insert(payload).then((inserted) => {
            // empty results means something wrong with the payload
            if (!inserted) throw boom.badData();

            if (co.isEmpty(inserted.ops) || co.isEmpty(inserted.ops[0])) {
                throw inserted;
            } else {
                // create thumbnail from the newly created slide revision
                let content = inserted.ops[0].revisions[0].content, slideId = inserted.ops[0]._id+'-'+1;
                if (content === '') {
                    // content = '<h2>'+inserted.ops[0].revisions[0].title+'</h2>';
                    // TODO for now we use hardcoded template for new slides
                    content = slidetemplate;
                }
                fileService.createThumbnail(content, slideId).catch((err) => {
                    logger.log('warn', `could not create thumbnail for new slide ${slideId}: ${err.message || err}`);
                });

                return co.rewriteID(inserted.ops[0]);
            }
        });

    },

    //updates slide by creating a new revision
    updateSlide: function(request, reply) {
        let userId = request.auth.credentials.userid;
        let slideId = request.params.id;

        // fill in the user id from auth
        request.payload.user = userId;

        { // these brackets are kept during handleChange removal to keep git blame under control

            deckDB.getActiveRevisionFromDB(request.payload.root_deck).then((parentDeckId) => {

                //update root deck with active revision
                if(parentDeckId)
                    request.payload.root_deck = parentDeckId;

                //create the slide revision in the database
                return slideDB.replace(slideId, request.payload).then((replaced) => {
                    if (co.isEmpty(replaced.value))
                        throw replaced;
                    else{

                        // send tags to tag-service
                        if(request.payload.tags && request.payload.tags.length > 0){
                            tagService.upload(request.payload.tags, userId).catch( (e) => {
                                request.log('warning', 'Could not save tags to tag-service for slide ' + slideId + ': ' + e.message);
                            });
                        }

                        //we must update all decks in the 'usage' attribute
                        return slideDB.get(replaced.value._id).then((newSlide) => {

                            // prepare the newSlide response object
                            newSlide.revisions = [newSlide.revisions[newSlide.revisions.length-1]];

                            //create thumbnail for the new slide revision
                            let content = newSlide.revisions[0].content, newSlideId = newSlide._id+'-'+newSlide.revisions[0].id;
                            if(content === ''){
                                content = '<h2>'+newSlide.revisions[0].title+'</h2>';
                                //for now we use hardcoded template for new slides
                                content = slidetemplate;
                            }
                            fileService.createThumbnail(content, newSlideId).catch((err) => {
                                request.log('warn', `could not create thumbnail for updated slide ${newSlideId}: ${err.message || err}`);
                            });

                            // update the content item of the parent deck with the new revision id
                            return deckDB.updateContentItem(newSlide, '', request.payload.root_deck, 'slide', userId, request.payload.top_root_deck)
                            .then(() => {
                                reply(newSlide);
                            });

                        });
                    }
                });

            }).catch((error) => {
                request.log('error', error);
                reply(boom.badImplementation());
            });

        }

    },

    // reverts a slide to a previous revision, w.r.t. a parent deck
    revertSlideRevision: function(request, reply) {
        let slideId = request.params.id;
        slideDB.exists(slideId).then((exists) => {
            if (!exists) return boom.notFound();

            let rootDeckId = request.payload.top_root_deck;
            // we need to find the parent from the path!
            return deckDB.findPath(rootDeckId, slideId, 'slide').then((path) => {
                // could not find path due to bad payload
                if (!path || !path.length) return boom.badData(`could not find slide: ${slideId} in deck tree: ${rootDeckId} `);

                // the parent of the slide is the second to last item of the path
                // path has at least length 2, guaranteed
                let [parentDeck] = path.slice(-2, -1);
                let parentDeckId = util.toIdentifier(parentDeck);

                let userId = request.auth.credentials.userid;
                return authorizeUser(userId, parentDeckId, rootDeckId).then((boomError) => {
                    if (boomError) return boomError;

                    let slide = util.parseIdentifier(slideId);
                    let revisionId = parseInt(request.payload.revision_id);
                    return slideDB.revert(slide.id, revisionId, path, userId).then((updatedSlide) => {
                        // if revert returns nothing, it's not because of 404, but no path was found!
                        if (!updatedSlide) return boom.badData(`unknown revision id: ${revisionId} for slide: ${slideId}`);

                        // keep only the new slide revision in revisions array for response
                        let slideRevision = updatedSlide.revisions.find((r) => r.id === revisionId);
                        updatedSlide.revisions = [slideRevision];
                        return updatedSlide;
                    });

                });

            });

        }).then((response) => {
            reply(response);
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });

    },

    //saves the data sources of a slide in the database
    saveDataSources: function(request, reply) {
        let slideId = request.params.id;

        slideDB.get(slideId).then( (slide) => {
            if(!slide)  return reply(boom.notFound());

            return slideDB.saveDataSources(slideId, request.payload).then((replaced) => {
                reply(replaced);
            });
        }).catch( (error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    getSlideDataSources: function(request, reply) {
        let slideId = request.params.id;
        slideDB.get(slideId).then((slide) => {
            if(!slide) return reply(boom.notFound());
            
            let items = slide.revisions[0].dataSources || [];
            let totalCount = items.length;
            if (request.query.countOnly) {
                items = [];
            }
            reply({ items, totalCount, revisionOwner: slide.user });
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    getDeckDataSources: function(request, reply) {
        deckDB.getRevision(request.params.id).then((deckRevision) => {
            // create data sources array
            if (!deckRevision) return reply(boom.notFound());

            if (_.isEmpty(deckRevision.contentItems)) {
                return reply({ items: [], totalCount: 0, revisionOwner: deckRevision.user });
            }

            let dataSources = [];

            // get first level of slides - from contentItems
            let arrayOfSlideIds = [];
            let slideRevisionsMap = {};
            let thereAreSubdecks = false;// does this deck have some subdecks
            deckRevision.contentItems.forEach((contentItem) => {
                if (contentItem.kind === 'slide') {
                    const slideId = contentItem.ref.id;
                    const revisionId = contentItem.ref.revision;
                    arrayOfSlideIds.push(slideId);
                    slideRevisionsMap[slideId] = revisionId;
                } else {
                    thereAreSubdecks = true;
                }
            });

            let promise = Promise.resolve({children: []});
            if (thereAreSubdecks) {
                //if there are subdecks, get the rest of slides, from deeper levels ( > 1 )
                promise = deckDB.getFlatSlides(request.params.id, undefined);
            }

            return promise.then((deckTree) => {
                deckTree.children.forEach((child) => {
                    let idArray = child.id.split('-');
                    const newSlideId = parseInt(idArray[0]);
                    const newSlideRevisionId = parseInt(idArray[1]);
                    if (!(newSlideId in slideRevisionsMap)) {
                        arrayOfSlideIds.push(newSlideId);
                        slideRevisionsMap[newSlideId] = newSlideRevisionId;
                    }
                });
            }).then(() => {
                // get dataSources
                return slideDB.getSelected({selectedIDs: arrayOfSlideIds})// get slides with ids in arrayOfSlideIds
                .then((slides) => {
                    slides.forEach((slide) => {
                        if (slide.revisions !== undefined && slide.revisions.length > 0 && slide.revisions[0] !== null) {
                            const slideId = slide._id;
                            const slideRevisionId = slideRevisionsMap[slideId];
                            let slideRevision = slide.revisions.find((revision) =>  String(revision.id) ===  String(slideRevisionId));
                            if (slideRevision !== undefined && slideRevision.dataSources !== null && slideRevision.dataSources !== undefined) {
                                const slideRevisionTitle = slideRevision.title;
                                slideRevision.dataSources.forEach((dataSource) => {
                                    //check that the dataSource has not already been added to the array
                                    let unique = true;
                                    for (let i = 0; i < dataSources.length; i++) {
                                        let dataSourceInArray = dataSources[i];
                                        if (dataSourceInArray.type === dataSource.type &&
                                            dataSourceInArray.title === dataSource.title &&
                                            dataSourceInArray.url === dataSource.url &&
                                            dataSourceInArray.comment === dataSource.comment &&
                                            dataSourceInArray.authors === dataSource.authors)
                                        {
                                            unique = false;
                                            break;
                                        }
                                    }
                                    if (unique) {
                                        dataSource.sid = slideId + '-' + slideRevisionId;
                                        dataSource.stitle = slideRevisionTitle;
                                        dataSources.push(dataSource);
                                    }
                                });
                            }
                        }
                    });

                    let items = dataSources;
                    let totalCount = items.length;
                    if (request.query.countOnly) {
                        items = [];
                    }
                    reply({ items, totalCount, revisionOwner: deckRevision.user });
                });
            });

        }).catch((error) => {
            if (error.isBoom) return reply(error);

            request.log('error', error);
            reply(boom.badImplementation());
        });

    },

    //gets a single deck from the database, containing all revisions, unless a specific revision is specified in the id
    getDeck: function(request, reply) {
        deckDB.get(encodeURIComponent(request.params.id)).then((deck) => {
            if (co.isEmpty(deck))
                reply(boom.notFound());
            else {
                const deckIdParts = request.params.id.split('-');
                const deckRevisionId = (deckIdParts.length > 1) ? deckIdParts[deckIdParts.length - 1] : deck.active;

                if (deck.revisions !== undefined && deck.revisions.length > 0 && deck.revisions[0] !== null) {
                    // add first slide id-revision for all revisions
                    deck.revisions.forEach((rev) => {
                        rev.firstSlide = deckDB.getFirstSlide(rev);
                    });

                    let deckRevision = deck.revisions.find((revision) => String(revision.id) === String(deckRevisionId));

                    if (deckRevision !== undefined) {
                        //add language of the active revision to the deck
                        if (deckRevision.language){
                            deck.language = deckRevision.language.length === 2 ? deckRevision.language : deckRevision.language.substring(0, 2);
                        }else{
                            deck.language = 'en';
                        }
                        reply(deck);
                    } else {
                        reply(deck);
                    }
                } else {
                    reply(deck);
                }
            }
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    getDeckTranslations: function(request, reply){
        let deckId = request.params.id; // it should already be a number

        deckDB.get(deckId).then((deck) => {
            if (!deck) return reply(boom.notFound());

            let currentLang = {'deck_id':deckId, 'language': deck.revisions[0].language};
            reply({'translations': deck.translations, 'currentLang':currentLang});

        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    getDeckRevisions: function(request, reply) {
        let deckId = request.params.id; // it should already be a number

        deckDB.get(deckId).then((deck) => {
            if (!deck) return boom.notFound();

            return deckDB.getChangesCounts(deckId).then((changesCounts) => {
                return deck.revisions.reverse().map((rev, index, list) => {
                    if (!rev.lastUpdate) {
                        // fill in missing lastUpdate from next revision
                        let nextRev = list[index + 1];
                        rev.lastUpdate = (nextRev && nextRev.timestamp) || deck.lastUpdate;
                    }

                    // keep only deck data
                    delete rev.contentItems;
                    delete rev.usage;

                    // normalize missing counts to 0
                    rev.changesCount = changesCounts[rev.id] || 0;

                    return rev;
                });
            });
        }).then((response) => {
            reply(response);
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });

    },

    //creates a new deck in the database
    newDeck: function(request, reply) {
        request.payload.user = request.auth.credentials.userid;

        //insert the deck into the database
        deckDB.insert(request.payload).then((inserted) => {
            // empty results means something wrong with the payload
            if (!inserted) return reply(boom.badData());

            if (co.isEmpty(inserted.ops) || co.isEmpty(inserted.ops[0]))
                throw inserted;
            else{
                //create a new slide inside the new deck
                let newSlide = {
                    'title': 'New slide',
                    'content': slidetemplate,
                    'language': request.payload.language,
                    'license': request.payload.license,
                    'user': inserted.ops[0].user,
                    'root_deck': String(inserted.ops[0]._id)+'-1',
                    'position' : 1
                };

                if(request.payload.hasOwnProperty('first_slide')){
                    if(request.payload.first_slide.hasOwnProperty('content')){
                        newSlide.content = request.payload.first_slide.content;
                    }
                    if(request.payload.first_slide.hasOwnProperty('title')){
                        newSlide.title = request.payload.first_slide.title;
                    }
                    if(request.payload.first_slide.hasOwnProperty('speakernotes')){
                        newSlide.speakernotes = request.payload.first_slide.speakernotes;
                    }
                }
                //insert the slide into the database
                return slideDB.insert(newSlide)
                .then((insertedSlide) => {
                    insertedSlide.ops[0].id = insertedSlide.ops[0]._id;
                    //update the content items of the new deck to contain the new slide
                    // top root is the root_deck if missing from payload
                    let top_root_deck = request.payload.top_root_deck || newSlide.root_deck;
                    let insertPromise = deckDB.insertNewContentItem(insertedSlide.ops[0], 0, newSlide.root_deck, 'slide', 1, newSlide.user, top_root_deck)
                    .then(() => {
                        reply(co.rewriteID(inserted.ops[0]));
                    });
                    //create the thumbnail for the new slide
                    let content = newSlide.content, slideId = insertedSlide.ops[0].id+'-'+1;
                    if(content === ''){
                        content = '<h2>'+newSlide.title+'</h2>';
                        //for now we use hardcoded template for new slides
                        content = slidetemplate;
                    }

                    fileService.createThumbnail(content, slideId).catch((err) => {
                        request.log('warn', `could not create thumbnail for new slide ${slideId}: ${err.message || err}`);
                    });

                    return insertPromise;
                });
            }
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    // new simpler implementation of deck update with permission checking and NO new_revision: true option
    updateDeck: function(request, reply) {
        let userId = request.auth.credentials.userid;

        let deckId = request.params.id;
        // TODO we should keep this required, no fall-back values!
        let rootDeckId = request.payload.top_root_deck;
        authorizeUser(userId, deckId, rootDeckId).then((boom) => {
            // authorizeUser returns nothing if all's ok
            if (boom) return boom;

            // force ignore new_revision
            delete request.payload.new_revision;

            // include user id in the payload!
            request.payload.user = userId;

            // update the deck without creating a new revision
            return deckDB.update(deckId, request.payload).then((replaced) => {
                if (!replaced) return boom.notFound();

                if (replaced.ok !== 1) throw replaced;

                // send tags to tag-service
                if (!_.isEmpty(request.payload.tags)) {
                    tagService.upload(request.payload.tags, userId).catch((e) => {
                        request.log('warning', 'Could not save tags to tag-service for deck ' + request.params.id + ': ' + e.message);
                    });
                }

                return replaced.value;
            });

        }).then((response) => {
            // response is either the deck update response or boom
            reply(response);
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    getDeckForks: function(request, reply) {
        let deckId = request.params.id;
        let userId = request.query.user || undefined;

        deckDB.getDeckForks(deckId, userId).then((forks) => {
            if (!forks) return reply(boom.notFound());

            // do some formatting
            reply(forks.map((fork) => {
                let [latestRevision] = fork.revisions.slice(-1);

                fork.id = fork._id;
                fork.title = latestRevision.title;

                return _.pick(fork, [
                    'id', 'title', 'user',
                    'timestamp', 'lastUpdate', 'current', 'origin',
                ]);

            }));
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    countDeckForks: function(request, reply) {
        let deckId = request.params.id;
        let userId = request.query.user || undefined;

        deckDB.countDeckForks(deckId, userId).then((forkCount) => {
            if (_.isNil(forkCount)) return reply(boom.notFound());

            reply(forkCount);
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    forkDeckRevision: function(request, reply) {
        let deckId = request.params.id;
        let userId = request.auth.credentials.userid;

        return deckDB.forkAllowed(deckId, userId)
        .then((forkAllowed) => {
            if (!forkAllowed) {
                return reply(boom.forbidden());
            }

            return deckDB.forkDeckRevision(deckId, userId).then((id_map) => {
                reply(id_map);
            });

        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });

    },

    translateDeckRevision: function(request, reply) {
        let deckId = request.params.id;
        let userId = request.auth.credentials.userid;

        return deckDB.forkAllowed(deckId, userId)
        .then((forkAllowed) => {
            if (!forkAllowed) {
                return reply(boom.forbidden());
            }

            return deckDB.translateDeckRevision(deckId, userId, request.payload.language).then((id_map) => {
                //We must iterate through all objects in the decktree of the fork and translate each one
                reply(id_map);
            });

        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });

    },

    // simply creates a new deck revision without updating anything
    createDeckRevision: function(request, reply) {
        let userId = request.auth.credentials.userid;

        let deckId = request.params.id;
        let rootDeckId = request.payload.top_root_deck;

        authorizeUser(userId, deckId, rootDeckId).then((boom) => {
            // authorizeUser returns nothing if all's ok
            if (boom) return boom;

            return deckDB.createDeckRevision(deckId, userId, rootDeckId);
        }).then((response) => {
            // response is either the new deck revision or boom
            reply(response);
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    // reverts a deck into a past revision
    revertDeckRevision: function(request, reply) {
        let userId = request.auth.credentials.userid;

        let deckId = request.params.id;
        let rootDeckId = request.payload.top_root_deck;

        authorizeUser(userId, deckId, rootDeckId).then((boom) => {
            // authorizeUser returns nothing if all's ok
            if (boom) return boom;

            // continue as normal
            let revisionId = request.payload.revision_id;

            return deckDB.revertDeckRevision(deckId, revisionId, userId, rootDeckId);
        }).then((response) => {
            // by now it's not a 404, which means the revision_id in the payload was invalid
            if (!response)
                response = boom.badData();

            // response is either the new deck revision or boom
            reply(response);
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    //gets the decktree with the given deck as root
    getDeckTree: function(request, reply) {

        if(request.query.enrich) {
            deckDB.get(request.params.id).then( (existingDeck) => {
                if(!existingDeck) return reply(boom.notFound());

                return deckDB.getEnrichedDeckTree(request.params.id).then( (decktree) => {
                    reply(decktree);
                });
            }).catch( (err) => {
                if(err.isBoom) return reply(err);

                request.log('error', err);
                reply(boom.badImplementation());                
            });
        } else {
            deckDB.getDeckTreeFromDB(request.params.id)
            .then((deckTree) => {
                if (!deckTree) return reply(boom.notFound());

                if (co.isEmpty(deckTree))
                    reply(boom.notFound());
                else{
                    reply(deckTree);
                }
            }).catch((err) => {
                request.log('error', err);
                reply(boom.badImplementation());
            });
        }
    },

    // authorize node creation and iterate nodeSpec array to apply each insert
    createDeckTreeNodeWithCheck: function(request, reply) {       
        let userId = request.auth.credentials.userid;
        let rootDeckId = request.payload.selector.id;

        // TODO proper authorization checking the actual parent id
        return authorizeUser(userId, rootDeckId, rootDeckId).then((boomError) => {
            if (boomError) return reply(boomError);

            let nodeSpecs = request.payload.nodeSpec;
            if (nodeSpecs.length < 2) {
                request.payload.nodeSpec = nodeSpecs[0];
                return self.createDeckTreeNode(request, reply);
            }

            // do some complex validations
            // we only support more than one nodeSpec when attaching,
            // so isMove cannot be true
            if (request.payload.isMove) {
                return reply(boom.badData());
            }

            // also, all ids should be valid numbers
            if (!nodeSpecs.every((node) => node.id && node.id !== '0')) {
                return reply(boom.badData());
            }

            // check if we append at the end (no position argument) or at a position
            let reverseOrder = (request.payload.selector.stype === 'slide');
            if (reverseOrder) {
                // if we *don't* attach to the end, we need to
                // reverse the node specs because they are added right after
                // the position specified in selector, like in a stack (LIFO)
                // we would like to provide the semantics of a queue (FIFO)
                nodeSpecs.reverse();
            } else {
                // if appending to deck lets remove the spath because we always attach to the last position
                request.payload.selector.spath = '';
            }

            async.concatSeries(nodeSpecs, (nodeSpec, done) => {
                // just put this nodespec
                request.payload.nodeSpec = nodeSpec;

                self.createDeckTreeNode(request, (result) => {
                    // an error already logged
                    if (result && result.isBoom) done(result);

                    // result is not an error
                    done(null, result);
                });
            }, (err, results) => {
                if (err) {
                    // an error already logged
                    if (err.isBoom) {
                        reply(err);
                    } else {
                        // an error in this method code, not logged
                        request.log('error', err);
                        reply(boom.badImplementation());
                    }
                } else {
                    // if needed, we again reverse the results to match the node spec order
                    if (reverseOrder) results.reverse();

                    reply(results);
                }
            });
        });

    },

    //creates a node (deck or slide) into the given deck tree
    createDeckTreeNode: function(request, reply) {
        let node = {};
        let top_root_deck = request.payload.selector.id;
        let userId = request.auth.credentials.userid;

        //check if it is a slide or a deck
        if(request.payload.nodeSpec.type === 'slide'){
            if(request.payload.nodeSpec.id && request.payload.nodeSpec.id !== '0'){
                //it means it is an existing node, we should retrieve the details
                let spath = request.payload.selector.spath;
                let spathArray = spath.split(';');
                let parentID, slidePosition;
                if(spathArray.length > 1){

                    let parentArrayPath = spathArray[spathArray.length-2].split(':');
                    parentID = parentArrayPath[0];

                } else if (request.payload.selector.stype === 'deck') {
                    parentID = request.payload.selector.sid;
                } else {
                    // means we are at root deck
                    parentID = request.payload.selector.id;
                }

                let slideArrayPath = spathArray[spathArray.length-1].split(':');
                slidePosition = parseInt(slideArrayPath[1])+1;

                let slideRevision = parseInt(request.payload.nodeSpec.id.split('-')[1])-1;
                self.getSlide({
                    'params' : {'id' : request.payload.nodeSpec.id.split('-')[0]},
                    'log': request.log.bind(request),
                }, (slide) => {
                    if (slide.isBoom) return reply(slide);

                    if (!request.payload.isMove) {
                        // if it's not a move op we are attaching a copy of a slide that may or may not be in the current tree

                        // let's keep the exact action tracked
                        let addAction = 'attach';
                        if (request.payload.nodeSpec.id === request.payload.selector.sid) {
                            addAction = 'copy';
                        }

                        //we must duplicate the slide
                        let duplicateSlide = slide;
                        duplicateSlide.parent = request.payload.nodeSpec.id;
                        duplicateSlide.comment = 'Duplicate slide of ' + request.payload.nodeSpec.id;
                        //copy the slide to a new duplicate
                        slideDB.copy(duplicateSlide, slideRevision)
                        .then((insertedDuplicate) => {
                            insertedDuplicate = insertedDuplicate.ops[0];
                            insertedDuplicate.id = insertedDuplicate._id;
                            node = {title: insertedDuplicate.revisions[0].title, id: insertedDuplicate.id+'-'+insertedDuplicate.revisions[0].id, type: 'slide'};
                            
                            let insertContentItemPromise = deckDB.insertNewContentItem(insertedDuplicate, slidePosition, parentID, 'slide', 1, userId, top_root_deck, addAction);
                            let addToUsagePromise = slideDB.addToUsage({ref:{id:insertedDuplicate._id, revision: 1}, kind: 'slide'}, parentID.split('-'));
                            
                            Promise.all([insertContentItemPromise, addToUsagePromise]).then( () => {
                                reply(node);
                            }).catch( (err) => {
                                request.log('error', err);
                                reply(boom.badImplementation());
                            });

                            let slideId = insertedDuplicate.id+'-'+insertedDuplicate.revisions[0].id;
                            fileService.createThumbnail(insertedDuplicate.revisions[0].content, slideId).catch((err) => {
                                request.log('warn', `could not create thumbnail for slide duplicate ${slideId}: ${err.message || err}`);
                            });
                        }).catch((err) => {
                            request.log('error', err);
                            reply(boom.badImplementation());
                        });
                    }
                    else{
                        //change position of the existing slide
                        slide.id = slide._id;

                        { // these brackets are kept during handleChange removal to keep git blame under control

                            let insertContentItemPromise = deckDB.insertNewContentItem(slide, slidePosition, parentID, 'slide', slideRevision+1, userId, top_root_deck);
                            let addToUsagePromise = slideDB.addToUsage({ref:{id:slide._id, revision: slideRevision+1}, kind: 'slide'}, parentID.split('-'));

                            Promise.all([insertContentItemPromise, addToUsagePromise]).then( () => {
                                node = {title: slide.revisions[slideRevision].title, id: slide.id+'-'+slide.revisions[slideRevision].id, type: 'slide'};
                                reply(node);
                            }).catch( (err) => {
                                request.log('error', err);
                                reply(boom.badImplementation());
                            });
                        }
                    }
                });
            }else{
                //need to make a new slide
                let spath = request.payload.selector.spath;
                let spathArray = spath.split(';');
                let parentID, slidePosition;
                if(spathArray.length > 1){

                    let parentArrayPath = spathArray[spathArray.length-2].split(':');
                    parentID = parentArrayPath[0];

                }
                else{
                    parentID = request.payload.selector.id;
                }
                let slideArrayPath = spathArray[spathArray.length-1].split(':');
                slidePosition = parseInt(slideArrayPath[1])+1;
                if(request.payload.selector.stype === 'deck'){
                    //selector is deck, we can get the root deck id directly
                    parentID = request.payload.selector.sid;
                    slidePosition = 0;
                }

                { // these brackets are kept during handleChange removal to keep git blame under control

                    self.getDeck({
                        'params': {'id':parentID},
                        'log': request.log.bind(request),
                    }, (parentDeck) => {
                        if (parentDeck.isBoom) return reply(parentDeck);

                        let slide = {
                            'title': 'New slide',
                            'content': slidetemplate,
                            'language': parentDeck.revisions[0].language,
                            'license': parentDeck.license,
                            'root_deck': parentID,
                            'position' : slidePosition
                        };

                        if(request.payload.hasOwnProperty('content')){
                            slide.content = request.payload.content;
                        }
                        if(request.payload.hasOwnProperty('title')){
                            slide.title = request.payload.title;
                        }
                        if(request.payload.hasOwnProperty('license')){
                            slide.license = request.payload.license;
                        }
                        if(request.payload.hasOwnProperty('speakernotes')){
                            slide.speakernotes = request.payload.speakernotes;
                        }

                        // create the new slide into the database
                        self._newSlide(slide, userId, request).then((createdSlide) => {
                            node = {title: createdSlide.revisions[0].title, id: createdSlide.id+'-'+createdSlide.revisions[0].id, type: 'slide'};
                            
                            //we have to return from the callback, else empty node is returned because it is updated asynchronously
                            deckDB.insertNewContentItem(createdSlide, slidePosition, parentID, 'slide', 1, userId, top_root_deck).then( () => {
                                reply(node);
                            }).catch( (err) => {
                                request.log('error', err);
                                reply(boom.badImplementation());
                            });

                        }).catch((err) => {
                            if (err.isBoom) return reply(err);

                            request.log('error', err);
                            reply(boom.badImplementation());
                        });
                    });
                }
            }
        }else{
            //create a deck node
            if(request.payload.nodeSpec.id && request.payload.nodeSpec.id !== '0'){
                //id is specified, it means it is an existing node
                let spath = request.payload.selector.spath;
                let spathArray = spath.split(';');
                let parentID, deckPosition;
                if(spathArray.length > 1){

                    let parentArrayPath = spathArray[spathArray.length-2].split(':');
                    parentID = parentArrayPath[0];

                }
                else{
                    parentID = request.payload.selector.sid;
                }
                if(request.payload.selector.stype === 'slide'){
                    parentID = request.payload.selector.id;
                }

                let deckArrayPath = spathArray[spathArray.length-1].split(':');
                deckPosition = parseInt(deckArrayPath[1])+1;
                let deckRevision = parseInt(request.payload.nodeSpec.id.split('-')[1])-1;

                //NOTE must check if it is a move action, if not, we are appending an external subdeck and we need to fork it
                if(request.payload.isMove){
                    self.getDeck({
                        'params': {'id' : request.payload.nodeSpec.id},
                        'log': request.log.bind(request),
                    }, (deck) => {
                        if (deck.isBoom) return reply(deck);

                        deck.id = deck._id;

                        { // these brackets are kept during handleChange removal to keep git blame under control

                            if(request.payload.selector.stype === 'deck'){
                                parentID = request.payload.selector.sid;
                            }
                            else{
                                parentID = request.payload.selector.id;
                            }

                            let insertContentItemPromise = deckDB.insertNewContentItem(deck, deckPosition, parentID, 'deck', deckRevision+1, userId, top_root_deck);
                            let addToUsagePromise = deckDB.addToUsage({ref:{id:deck._id, revision: deckRevision+1}, kind: 'deck'}, parentID.split('-'));
                            
                            Promise.all([insertContentItemPromise, addToUsagePromise]).then( () => {
                                //we have to return from the callback, else empty node is returned because it is updated asynchronously
                                self.getDeckTree({
                                    'params': {'id' : deck.id},
                                    'log': request.log.bind(request),
                                }, (deckTree) => {
                                    if (deckTree.isBoom) return reply(deckTree);

                                    reply(deckTree);
                                });
                            }).catch( (err) => {
                                request.log('error', err);
                                reply(boom.badImplementation());
                            });
                            
                        }
                    });
                }
                else{
                    deckDB.forkDeckRevision(request.payload.nodeSpec.id, userId, true).then((forkResult) => {
                        // get the new deck we are going to attach
                        request.payload.nodeSpec.id = forkResult.root_deck;

                        deckRevision = parseInt(request.payload.nodeSpec.id.split('-')[1])-1;
                        self.getDeck({
                            'params': {'id' : request.payload.nodeSpec.id},
                            'log': request.log.bind(request),
                        }, (deck) => {
                            if (deck.isBoom) return reply(deck);

                            deck.id = deck._id;
                            { // these brackets are kept during handleChange removal to keep git blame under control

                                if(request.payload.selector.stype === 'deck'){
                                    parentID = request.payload.selector.sid;
                                }
                                else{
                                    parentID = request.payload.selector.id;
                                }

                                // omitting the top_root_deck means this change won't be tracked,
                                // as it will be tracked right after this code, we just need to attach
                                // first so that the rest of the tracking will work
                                return deckDB.insertNewContentItem(deck, deckPosition, parentID, 'deck', deckRevision+1, userId).then(() => {
                                    return Promise.all([
                                        // track all created forks AFTER it's attached
                                        deckDB._trackDecksForked(top_root_deck, forkResult.id_map, userId, true),
                                        // add to usage AFTER it's attached
                                        deckDB.addToUsage({ref:{id:deck._id, revision: deckRevision+1}, kind: 'deck'}, parentID.split('-')),
                                        //we have to return from the callback, else empty node is returned because it is updated asynchronously
                                        self.getDeckTree({
                                            'params': {'id' : deck.id},
                                            'log': request.log.bind(request),
                                        }, (deckTree) => {
                                            if (deckTree.isBoom) return reply(deckTree);

                                            reply(deckTree);
                                        }),
                                    ]);

                                });

                            }
                        });

                    }).catch((err) => {
                        request.log('error', err);
                        reply(boom.badImplementation());
                    });
                }
            }else{
                //id is not specified, we need to make a new deck
                let spath = request.payload.selector.spath;
                let spathArray = spath.split(';');
                let parentID, deckPosition;
                if(spathArray.length > 1){

                    let parentArrayPath = spathArray[spathArray.length-2].split(':');
                    parentID = parentArrayPath[0];

                }
                else{
                    parentID = request.payload.selector.id;
                }
                if(request.payload.selector.stype === 'deck'){
                    parentID = request.payload.selector.sid;
                }

                let deckArrayPath = spathArray[spathArray.length-1].split(':');
                deckPosition = parseInt(deckArrayPath[1])+1;

                { // these brackets are kept during handleChange removal to keep git blame under control

                    self.getDeck({
                        'params': {'id':parentID},
                        'log': request.log.bind(request),
                    }, (parentDeck) => {
                        if (parentDeck.isBoom) return reply(parentDeck);

                        let deck = {
                            'description': '',
                            'title': 'New deck',
                            'content': slidetemplate,
                            'language': parentDeck.revisions[0].language,
                            'license': parentDeck.license,
                            'user': userId,
                            'root_deck': parentID,
                            'top_root_deck': top_root_deck,
                            'position' : deckPosition
                        };
                        //create the new deck
                        self.newDeck({
                            'payload' : deck,
                            'auth': request.auth,
                            'log': request.log.bind(request),
                        }, (createdDeck) => {
                            if (createdDeck.isBoom) return reply(createdDeck);

                            let insertPromise = Promise.resolve();
                            if (parentID) {
                                insertPromise = deckDB.insertNewContentItem(createdDeck, deckPosition, parentID, 'deck', 1, userId, top_root_deck);
                            }

                            insertPromise.then(() => {
                                // we have to return from the callback, else empty node is returned because it is updated asynchronously
                                self.getDeckTree({
                                    'params': {'id' : createdDeck.id},
                                    'log': request.log.bind(request),
                                }, (deckTree) => {
                                    if (deckTree.isBoom) return reply(deckTree);

                                    reply(deckTree);
                                });
                            }).catch((err) => {
                                request.log('error', err);
                                reply(boom.badImplementation());
                            });

                        });
                    });
                }
            }
        }
    },

    //renames a decktree node (slide or deck)
    renameDeckTreeNode: function(request, reply) {
        let userId = request.auth.credentials.userid;

        //check if it is deck or slide
        if(request.payload.selector.stype === 'deck'){
            let root_deck = request.payload.selector.sid;

            { // these brackets are kept during handleChange removal to keep git blame under control

                let top_root_deck = request.payload.selector.id;
                deckDB.rename(root_deck, request.payload.name, top_root_deck, userId).then((renamed) => {
                    if (co.isEmpty(renamed.value))
                        throw renamed;
                    else{
                        let response = {'title' : renamed.value};
                        reply(response);
                    }
                }).catch((error) => {
                    request.log('error', error);
                    reply(boom.badImplementation());
                });
            }

        }else {
            //it is a slide, must find root deck id
            let root_deck ;
            let slide_id = request.payload.selector.sid;
            let spath = request.payload.selector.spath;
            let spathArray = spath.split(';');
            if(spathArray.length > 1){
                let parentArrayPath = spathArray[spathArray.length-2].split(':');
                root_deck = parentArrayPath[0];
            }
            else{
                root_deck = request.payload.selector.id;
            }
            //we must create a new slide revision as well, because of renaming it
            self.getSlide({
                'params' : {'id' : slide_id},
                'log': request.log.bind(request),
            }, (slide) => {
                if (slide.isBoom) return reply(slide);

                let new_slide = {
                    'title' : request.payload.name,
                    'content' : slide.revisions[0].content,
                    'speakernotes' : slide.revisions[0].speakernotes,
                    'user' : String(userId),
                    'root_deck' : root_deck,
                    'top_root_deck' : request.payload.selector.id,
                    'language' : slide.language,
                    'license' : slide.license,
                    'tags' : slide.revisions[0].tags,
                    'dataSources' : slide.revisions[0].dataSources
                };
                if(new_slide.speakernotes === null){
                    new_slide.speakernotes = '';
                }
                if(new_slide.tags === null){
                    new_slide.tags = [];
                }
                if(new_slide.dataSources === null){
                    new_slide.dataSources = [];
                }
                let forwardedRequest = {
                    'params' : {'id' :encodeURIComponent(slide_id)},
                    'payload' : new_slide,
                    'auth': request.auth,
                    'log': request.log.bind(request),
                };
                self.updateSlide(forwardedRequest, (updated) => {
                    reply(updated);
                });
            });
        }
    },
    //deletes a decktree node by removing its reference from its parent deck (does not actually delete it from the database)
    deleteDeckTreeNode: function(request, reply) {
        let userId = request.auth.credentials.userid;

        //NOTE no removal in the DB, just unlink from content items, and update the positions of the other elements
        let spath = request.payload.selector.spath;
        let spathArray = spath.split(';');
        let parentID, itemPosition;
        if(spathArray.length > 1){

            let parentArrayPath = spathArray[spathArray.length-2].split(':');
            parentID = parentArrayPath[0];

        }
        else{
            parentID = request.payload.selector.id;
        }

        let itemArrayPath = spathArray[spathArray.length-1].split(':');
        itemPosition = itemArrayPath[1];

        { // these brackets are kept during handleChange removal to keep git blame under control

            //remove link of content item from db
            let top_root_deck = request.payload.selector.id;
            deckDB.removeContentItem(itemPosition, parentID, top_root_deck, userId)
            .then((removed) => {
                if(!removed){
                    removed = {};
                }
                reply(removed);
            })
            .catch((err) => {
                request.log('error', err);
                reply(boom.badImplementation());
            });
        }

    },
    //changes position of a deck tree node inside the decktree
    moveDeckTreeNode: function(request, reply) {
        let userId = request.auth.credentials.userid;

        //first delete the node from its current position
        self.deleteDeckTreeNode({
            'payload': {'selector' : request.payload.sourceSelector, 'user': String(userId), 'isMove' : true},
            'auth': request.auth,
            'log': request.log.bind(request),
        },
        (removed) => {
            if (removed.isBoom) return reply(removed);
            //must update revision ids
            let nodeSpec = {'id': request.payload.sourceSelector.sid, 'type': request.payload.sourceSelector.stype};
            let sourceParentDeck = request.payload.sourceSelector.id;
            let spathArray = request.payload.sourceSelector.spath.split(';');
            if(spathArray.length > 1){

                let parentArrayPath = spathArray[spathArray.length-2].split(':');
                sourceParentDeck = parentArrayPath[0];
            }
            let targetParentDeck = request.payload.targetSelector.id;
            if(request.payload.targetSelector.spath !== ''){
                if(request.payload.targetSelector.stype === 'deck'){
                    targetParentDeck = request.payload.targetSelector.sid;
                }
                else{
                    let targetspathArray = request.payload.targetSelector.spath.split(';');
                    if(targetspathArray.length > 1){

                        let parentArrayPath = targetspathArray[targetspathArray.length-2].split(':');
                        targetParentDeck = parentArrayPath[0];
                    }
                    else{
                        let parentArrayPath = targetspathArray[targetspathArray.length-1].split(':');
                        targetParentDeck = parentArrayPath[0];
                    }
                }

            }

            let removed_changeset, inserted_changeset ;
            if(removed.hasOwnProperty('changeset')){
                //handle changes coming from the recursive revisioning
                removed_changeset = removed.changeset;
                if(removed_changeset.hasOwnProperty('new_revisions')){
                    for(let i = 0; i < removed_changeset.new_revisions.length; i++){
                        let next_new_revision = removed_changeset.new_revisions[i];
                        if(i === 0 && removed_changeset.new_revisions[i].hasOwnProperty('root_changed')){
                            next_new_revision = removed_changeset.new_revisions[i].root_changed;
                        }
                        let next_new_revision_path = next_new_revision.split('-');
                        if(sourceParentDeck.split('-')[0] === next_new_revision_path[0]){
                            sourceParentDeck = sourceParentDeck.split('-')[0] + '-' + next_new_revision_path[1];
                        }
                        if(targetParentDeck.split('-')[0] === next_new_revision_path[0]){
                            targetParentDeck = targetParentDeck.split('-')[0] + '-' + next_new_revision_path[1];
                        }
                        if(request.payload.targetSelector.sid.split('-')[0] === next_new_revision_path[0]){
                            request.payload.targetSelector.sid = request.payload.targetSelector.sid.split('-')[0] + '-' + next_new_revision_path[1];
                        }
                        if(request.payload.targetSelector.id.split('-')[0] === next_new_revision_path[0]){
                            request.payload.targetSelector.id = request.payload.targetSelector.id.split('-')[0] + '-' + next_new_revision_path[1];
                        }
                        if(nodeSpec.id.split('-')[0] === next_new_revision_path[0]){
                            nodeSpec.id = nodeSpec.id.split('-')[0] + '-' + next_new_revision_path[1];
                        }
                    }
                }
            }

            let itemArrayPath = spathArray[spathArray.length-1].split(':');
            let itemPosition = itemArrayPath[1];
            if(sourceParentDeck === targetParentDeck && parseInt(itemPosition) < request.payload.targetIndex){
                request.payload.targetIndex--;
            }
            request.payload.targetSelector.spath = request.payload.targetSelector.sid + ':' + request.payload.targetIndex;
            if(request.payload.targetSelector.id.split('-')[0] === request.payload.targetSelector.sid.split('-')[0]){
                request.payload.targetSelector.id = request.payload.targetSelector.sid;
            }
            let forwardedRequest  = {
                'payload': {
                    'selector': request.payload.targetSelector,
                    'nodeSpec': nodeSpec,
                    'isMove' : true
                },
                'auth': request.auth,
                'log': request.log.bind(request),
            };
            //append the node (revised or not) in the new position
            self.createDeckTreeNode(forwardedRequest,
            (inserted) => {
                if (inserted.isBoom) return reply(inserted);

                if(inserted.hasOwnProperty('changeset') && removed.hasOwnProperty('changeset')){
                    inserted_changeset = inserted.changeset;
                    inserted.inserted_changeset = inserted_changeset;
                    inserted.removed_changeset = removed_changeset;
                }
                else if(removed.hasOwnProperty('changeset')){
                    inserted.changeset = removed_changeset;
                }
                if(inserted.hasOwnProperty('changeset')){
                    inserted_changeset = inserted.changeset;
                    inserted.changeset = inserted_changeset;
                }
                reply(inserted);
            });
        });

    },
    //gets a flat listing of the slides from deck and all of its sub-decks with optional offset and limit
    getFlatSlides: function(request, reply){
        deckDB.getFlatSlides(request.params.id, undefined)
        .then((deckTree) => {
            if (co.isEmpty(deckTree)){
                return reply(boom.notFound());
            }
            if(typeof request.query.limit !== 'undefined' || typeof request.query.offset !== 'undefined'){
                let limit = request.query.limit, offset = request.query.offset;
                if(typeof limit !== 'undefined'){
                    limit = parseInt(limit);
                    if(limit < 0 || limit > deckTree.children.length || isNaN(limit))
                        limit = deckTree.children.length;
                }
                else{
                    limit = deckTree.children.length;
                }

                if(typeof offset !== 'undefined'){
                    offset = parseInt(offset);
                    if(offset < 0 || offset >= deckTree.children.length)
                        offset = 0;
                }
                else{
                    offset = 0;
                }

                let ending = parseInt(offset)+parseInt(limit);
                deckTree.children = deckTree.children.slice(offset, ending);
            }

            if(request.query.countOnly){
                reply({slidesCount: deckTree.children.length});
            } else {
                deckTree.slidesCount = deckTree.children.length;
                reply(deckTree);
            }
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    //returns the editors of a deck
    getEditors: function(request, reply){
        let deckId = request.params.id;

        // we need the explicit editors in the deck object
        deckDB.get(deckId)
        .then((deck) => {
            if (!deck) return reply(boom.notFound());

            let editors = deck.editors || { users: [], groups: [] };
            // editors.users = _.map(editors.users || [], ['id', 'joined']);
            editors.users = editors.users || [];
            // editors.groups = _.map(editors.groups || [], ['id', 'joined']);
            editors.groups = editors.groups || [];

            // connecting to userService might fail, in that case response will include what the deck service can provide
            return Promise.all([
                userService.fetchUserInfo(_.map(editors.users, 'id'))
                .then((userInfo) => util.assignToAllById(editors.users, userInfo))
                .catch((err) => {
                    request.log('warn', `could not fetch user info: ${err.message || err}`);
                    return editors.users;
                }),

                userService.fetchGroupInfo(_.map(editors.groups, 'id'))
                .then((groupInfo) => util.assignToAllById(editors.groups, groupInfo))
                .catch((err) => {
                    request.log('warn', `could not fetch group info: ${err.message || err}`);
                    return editors.groups;
                }),

                // we also need the implicit editors (AKA contributors)...
                deckDB.getDeckEditors(deckId)
                .then((contribIds) => {
                    let contributors = contribIds.map((id) => ({ id }) );
                    return userService.fetchUserInfo(contribIds)
                    .then((contribInfo) => util.assignToAllById(contributors, contribInfo))
                    .catch((err) => {
                        request.log('warn', `could not fetch group info: ${err.message || err}`);
                        return contributors;
                    });
                }),

            ]).then(([users, groups, contributors]) => {
                reply({
                    contributors,
                    editors: { users, groups }
                });
            });

        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    replaceEditors: function(request, reply) {
        let deckId = request.params.id;
        let userId = request.auth.credentials.userid;

        deckDB.get(deckId).then((deck) => {
            if(!deck)   return reply(boom.notFound());

            // permit deck owner only to use this
            if (userId !== deck.user) return reply(boom.forbidden());

            // TODO for now all subdecks should have the same owner, so no further authorization required
            return deckDB.deepReplaceEditors(deckId, request.payload).then(() => reply());

        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    userPermissions: function(request, reply) {
        let deckId = request.params.id;
        let userId = request.auth.credentials.userid;

        deckDB.userPermissions(deckId, userId).then((perm) => {
            if (!perm) return reply(boom.notFound());

            reply(perm);
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation(err));
        });

    },

    //gets all recent decks
    getAllRecent: (request, reply) => {
        let limit = parseInt(request.params.limit);
        let offset = parseInt(request.params.offset);

        deckDB.getAllRecent(limit, offset).then( (recentDecks) => {
            if(!recentDecks) return reply([]);

            let userIds = new Set(), countForksIds = new Set();

            // collect user ids and deck ids to count forks needed
            recentDecks.forEach( (deck) => {
                userIds.add(deck.user);
                countForksIds.add(deck._id);
            });

            // count deck forks for the abouve deck ids
            let forkCounts = {};
            let forkCountsPromise = deckDB.countManyDeckForks([...countForksIds]).then( (forkCountsInfo) => {
                forkCountsInfo.forEach( (forkCount) => {
                    forkCounts[forkCount._id] = forkCount.forkCount;
                });
            });

            // fetch usernames for user ids needed
            let usernames = {};
            let userPromise = userService.fetchUserInfo([...userIds]).then( (userInfo) => {
                userInfo.forEach( (u) => {
                    usernames[u.id] = u.username;
                });
            });

            return Promise.all([userPromise, forkCountsPromise]).then( () => {

                recentDecks = recentDecks.map( (deck) => {

                    // get active revision
                    let activeRevision = deck.revisions.find((rev) => (rev.id === deck.active));
                    if(!activeRevision) return null;

                    // get latest revision
                    let [latestRevision] = deck.revisions.slice(-1);

                    return {
                        _id: deck._id,
                        title: activeRevision.title,
                        description: deck.description,
                        user: deck.user,
                        username: (usernames[deck.user]) ? usernames[deck.user] : 'Unknown user',
                        active: deck.active,
                        countRevisions: deck.revisions.length,
                        timestamp: deck.timestamp,
                        language: (activeRevision.language) ? activeRevision.language.substring(0, 2) : 'en',
                        forkCount: (forkCounts[deck._id]) ? forkCounts[deck._id] : 0,
                        firstSlide: deckDB.getFirstSlide(activeRevision),
                        revisionId: activeRevision.id,
                        latestRevisionId: latestRevision.id
                    };
                }).filter( (deck) => { return deck != null; });

                reply(recentDecks);

            }).catch( (err) => {
                request.log('error', err);
                reply(boom.badImplementation());
            });
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    //gets all featured decks
    getAllFeatured: (request, reply) => {
        let limit = parseInt(request.params.limit);
        let offset = parseInt(request.params.offset);

        deckDB.getAllFeatured(limit, offset).then( (featuredDecks) => {
            if(!featuredDecks) return reply([]);

            let userIds = new Set(), countForksIds = new Set();

            // collect user ids and deck ids to count forks needed
            featuredDecks.forEach( (deck) => {
                userIds.add(deck.user);
                countForksIds.add(deck._id);
            });

            // count deck forks for the abouve deck ids
            let forkCounts = {};
            let forkCountsPromise = deckDB.countManyDeckForks([...countForksIds]).then( (forkCountsInfo) => {
                forkCountsInfo.forEach( (forkCount) => {
                    forkCounts[forkCount._id] = forkCount.forkCount;
                });
            });

            // fetch usernames for user ids needed
            let usernames = {};
            let userPromise = userService.fetchUserInfo([...userIds]).then( (userInfo) => {
                userInfo.forEach( (u) => {
                    usernames[u.id] = u.username;
                });
            });

            return Promise.all([userPromise, forkCountsPromise]).then( () => {
                featuredDecks = featuredDecks.map( (deck) => {

                    // get active revision
                    let activeRevision = deck.revisions.find((rev) => (rev.id === deck.active));
                    if(!activeRevision) return null;

                    // get latest revision
                    let [latestRevision] = deck.revisions.slice(-1);

                    return {
                        _id: deck._id,
                        title: activeRevision.title,
                        description: deck.description,
                        user: deck.user,
                        username: (usernames[deck.user]) ? usernames[deck.user] : 'Unknown user',
                        active: deck.active,
                        countRevisions: deck.revisions.length,
                        timestamp: deck.timestamp,
                        language: (activeRevision.language) ? activeRevision.language.substring(0, 2) : 'en',
                        forkCount: (forkCounts[deck._id]) ? forkCounts[deck._id] : 0,
                        firstSlide: deckDB.getFirstSlide(activeRevision),
                        revisionId: activeRevision.id,
                        latestRevisionId: latestRevision.id
                    };
                });

                reply(featuredDecks);
            });
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    //returns metadata about all decks a user owns
    getAllDecks: (request, reply) => {
        //TODO another API for user activity is needed

        //parse userid
        let userid = request.params.userid;
        const integerSchema = Joi.number().integer();
        const validationResult = integerSchema.validate(userid);
        if (validationResult.error === null) {
            userid = validationResult.value;
        }

        let decksPromise = deckDB.find('decks', {
            user: userid
        });

        decksPromise.then((decks) => {
            let result = [];

            decks.forEach((deck) => {
                let metadata = {};
                metadata._id = deck._id;
                metadata.timestamp = deck.timestamp;
                metadata.description = deck.description;
                metadata.lastUpdate = deck.lastUpdate;
                metadata.tags = deck.tags;
                metadata.translation = deck.translation;
                metadata.countRevisions = deck.revisions.length;
                metadata.active = deck.active;

                //get revision
                let revision = {};
                for (let key in deck.revisions) {
                    if (deck.revisions[key].id === deck.active)
                        revision = deck.revisions[key];
                }

                metadata.title = revision.title;
                metadata.comment = revision.comment;
                metadata.abstract = revision.abstract;
                metadata.license = revision.license;
                metadata.priority = revision.priority;
                metadata.visibility = revision.visibility;
                if (revision.language){
                    metadata.language = revision.language.length === 2 ? revision.language : revision.language.substring(0, 2);
                }else{
                    metadata.language = 'en';
                }
                metadata.translation = revision.translation;
                metadata.tags = revision.tags;
                metadata.parent = revision.parent;

                // get first slide
                metadata.firstSlide = deckDB.getFirstSlide(revision);

                result.push(metadata);
            });

            return reply(result);

        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    //counts the revisions of a given deck
    countDeckRevisions: function(request, reply){
        deckDB.get(request.params.id.split('-')[0]).then((foundDeck) => {
            if(!foundDeck){
                reply(boom.notFound());
            }
            else{
                reply(foundDeck.revisions.length);
            }
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    //counts the slide revisions of a given slide
    countSlideRevisions: function(request, reply){
        slideDB.get(request.params.id.split('-')[0]).then((foundSlide) => {
            if(!foundSlide){
                reply(boom.notFound());
            }
            else{
                reply(foundSlide.revisions.length);
            }
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    getDeckUsage: function(request, reply) {
        let deckId = request.params.id;
        let deck = util.parseIdentifier(deckId);
        deckDB.get(deck.id).then((existingDeck) => {
            if (!existingDeck) return boom.notFound();

            return deckDB.getUsage(deckId);

            // TODO dead code
            return deckDB.getRootDecks(deckId)
            .then((roots) => {
                return roots;
                // TODO dead code
                return Promise.all(roots.map((r) => {
                    return deckDB.findPath(util.toIdentifier(r), deckId)
                    .then((path) => {
                        let [leaf] = path.slice(-1);
                        leaf.id = deck.id;
                        leaf.revision = deck.revision || r.using;
                        return path;
                    });
                })).then((paths) => paths.map(util.toPlatformPath));
            });

        }).then(reply).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    getDeckRootDecks: function(request, reply){
        let deckId = request.params.id;
        let deck = util.parseIdentifier(deckId);
        deckDB.get(deck.id).then((existingDeck) => {
            if (!existingDeck) return boom.notFound();

            return deckDB.getRootDecks(deckId)
            .then((roots) => {
                return roots;
                // TODO dead code
                return Promise.all(roots.map((r) => {
                    return deckDB.findPath(util.toIdentifier(r), deckId)
                    .then((path) => {
                        let [leaf] = path.slice(-1);
                        leaf.id = deck.id;
                        leaf.revision = deck.revision || r.using;
                        return path;
                    });
                })).then((paths) => paths.map(util.toPlatformPath));
            });

        }).then(reply).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    getSlideUsage: function(request, reply) {
        let slideId = request.params.id;
        let slide = util.parseIdentifier(slideId);
        slideDB.get(slide.id).then((existingSlide) => {
            if (!existingSlide) return boom.notFound();

            return deckDB.getUsage(slideId, 'slide');

            // TODO dead code
            return deckDB.getRootDecks(slideId, 'slide').then((roots) => {
                return roots;
                // TODO dead code
                return Promise.all(roots.map((r) => {
                    // path method does not return the slide id, so we take it from the root
                    return deckDB.findPath(util.toIdentifier(r), slideId, 'slide')
                    .then((path) => {
                        let [leaf] = path.slice(-1);
                        leaf.id = slide.id;
                        leaf.revision = slide.revision || r.using;
                        leaf.kind = 'slide';

                        return path;
                    });
                })).then((paths) => paths.map(util.toPlatformPath));

            });
        }).then(reply).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    getSlideRootDecks: function(request, reply){
        let slideId = request.params.id;
        let slide = util.parseIdentifier(slideId);
        slideDB.get(slide.id).then((existingSlide) => {
            if (!existingSlide) return boom.notFound();

            return deckDB.getRootDecks(slideId, 'slide').then((roots) => {
                return roots;
                // TODO dead code
                return Promise.all(roots.map((r) => {
                    // path method does not return the slide id, so we take it from the root
                    return deckDB.findPath(util.toIdentifier(r), slideId, 'slide')
                    .then((path) => {
                        let [leaf] = path.slice(-1);
                        leaf.id = slide.id;
                        leaf.revision = slide.revision || r.using;
                        leaf.kind = 'slide';

                        return path;
                    });
                })).then((paths) => paths.map(util.toPlatformPath));

            });
        }).then(reply).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    getDeckTags: function(request, reply){
        deckDB.getTags(request.params.id).then( (tagsList) => {
            if(!tagsList){
                reply(boom.notFound());
            }
            else{
                reply(tagsList);
            }
        }).catch( (err) => {
            request.log(err);
            reply(boom.badImplementation());
        });
    },

    updateDeckTags: function(request, reply) {
        let userId = request.auth.credentials.userid;
        let operation = (request.payload.operation === 'add') ? deckDB.addTag.bind(deckDB) : deckDB.removeTag.bind(deckDB);

        operation(request.params.id, request.payload.tag).then( (tagsList) => {
            if(!tagsList){
                reply(boom.notFound());
            }
            else{
                // send tags to tag-service
                if(tagsList && tagsList.length > 0){
                    tagService.upload(tagsList, userId).catch( (e) => {
                        request.log('warning', 'Could not save tags to tag-service for deck ' + request.params.id + ': ' + e.message);
                    });
                }

                reply(tagsList);
            }
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    replaceDeckTags: function(request, reply) {
        let userId = request.auth.credentials.userid;

        let deckId = request.params.id;
        let rootDeckId = request.payload.top_root_deck;

        authorizeUser(userId, deckId, rootDeckId).then((boomError) => {
            if (boomError) return boomError;

            return deckDB.get(deckId).then( (deck) => { 
                if(!deck) return boom.notFound();

                return deckDB.replaceTags(deckId, request.payload.tags, userId, rootDeckId).then((updatedDeck) => {
                    return updatedDeck;
                });
            });
        }).then( (response) => {
            // response is either the deck update or boom
            reply(response);
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    getSlideTags: function(request, reply){
        slideDB.getTags(request.params.id).then( (tagsList) => {
            if(!tagsList){
                reply(boom.notFound());
            }
            else{
                reply(tagsList);
            }
        }).catch( (err) => {
            request.log(err);
            reply(boom.badImplementation());
        });
    },

    updateSlideTags: function(request, reply) {
        let userId = request.auth.credentials.userid;
        let operation = (request.payload.operation === 'add') ? slideDB.addTag.bind(slideDB) : slideDB.removeTag.bind(slideDB);

        operation(request.params.id, request.payload.tag).then( (tagsList) => {
            if(!tagsList){
                reply(boom.notFound());
            }
            else{
                // send tags to tag-service
                if(tagsList && tagsList.length > 0){
                    tagService.upload(tagsList, userId).catch( (e) => {
                        request.log('warning', 'Could not save tags to tag-service for slide ' + request.params.id + ': ' + e.message);
                    });
                }

                reply(tagsList);
            }
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    getDeckMedia: function(request, reply){
        deckDB.getMedia(request.params.id, request.query.mediaType).then( (deckMedia) => {
            if(!deckMedia){
                reply(boom.notFound());
            }
            else{
                reply(deckMedia);
            }
        }).catch( (error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    }, 

    getDeckDeepUsage: function(request, reply){
        let deckId = request.params.id;

        deckDB.get(deckId).then( (deck) => {
            if(!deck)   return reply(boom.notFound());

            return deckDB.getDeepUsage(deckId, 'deck', request.query.keepVisibleOnly).then( (usage) => {
                if(!usage){
                    reply(boom.notFound());
                } else {
                    reply(usage);
                }
            });
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    getSlideDeepUsage: function(request, reply){
        let slideId = request.params.id;

        slideDB.exists(slideId).then( (exists) => { 
            if(!exists) return reply(boom.notFound());

            return deckDB.getDeepUsage(slideId, 'slide', request.query.keepVisibleOnly).then( (usage) => {
                if(!usage){
                    reply(boom.notFound());
                } else {
                    reply(usage);
                }
            });
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    }, 

    getForkGroup: function(request, reply){
        deckDB.computeForkGroup(request.params.id).then( (forkGroup) => {
            if(_.isEmpty(forkGroup)){
                reply(boom.notFound());
            } else {
                reply(forkGroup);
            }
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    regenThumbnails: function(request, reply) {
        let deckId = request.params.id;

        deckDB.getFlatSlides(deckId).then((deckTree) => {
            if (!deckTree) return reply(boom.notFound());

            async.concatSeries(deckTree.children, (slide, done) => {
                if (!slide.content) {
                    slide.content = `<h2>${slide.title}</h2>`;
                }

                fileService.createThumbnail(slide.content, slide.id).then(() => {
                    done(null, { id: slide.id, status: 'OK' });
                }).catch((err) => {
                    done(null, { id: slide.id, status: err.message });
                });
            }, (err, results) => {
                if (err) {
                    request.log('error', err);
                    reply(boom.badImplementation());
                } else {
                    reply(results);
                }
            });

        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

};

// TODO move these to services / utility libs

// reusable method that authorizes user for editing a deck given the deck tree root deck
function authorizeUser(userId, deckId, rootDeckId) {
    let permissionChecks = _.uniq([deckId, rootDeckId])
    .map((id) => deckDB.userPermissions(id, userId));

    return Promise.all(permissionChecks).then((perms) => {
        // return 404 for deckId missing as it's on the path
        if (!perms[0]) return boom.notFound();

        // if others are not found return 422 instead of 404 (not part of path)
        if (perms.some((p) => p === undefined)) return boom.badData();

        // check edit permission
        if (perms.some((p) => !p.edit)) return boom.forbidden();

        // check readOnly status
        if (perms.some((p) => p.readOnly)) return boom.forbidden();

        // return nothing if all's ok :)
    });

}
