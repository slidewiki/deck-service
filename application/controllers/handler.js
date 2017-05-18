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
    async = require('async'),
    Microservices = require('../configs/microservices');

const userService = require('../services/user');

const tagService = require('../services/tag');

const slidetemplate = '<div class="pptx2html" style="position: relative; width: 960px; height: 720px;">'+
    '<p></p><p></p><p></p><p></p><p></p><div _id="2" _idx="undefined" _name="Title 1" _type="title" class="block content v-mid" style="position: absolute; top: 38.3334px; left: 66px; width: 828px; height: 139.167px; z-index: 23488;">'+
    '<h3 class="h-mid"><span class="text-block" style="font-weight: initial; font-style: normal; text-decoration: initial; vertical-align: ;">Title</span></h3></div>'+
    '<div _id="3" _idx="1" _name="Content Placeholder 2" _type="body" class="block content v-up" style="position: absolute; top: 191.667px; left: 66px; width: 828px; height: 456.833px; z-index: 23520;">'+
    '<ul>'+
    '	<li class="h-left" style="text-align: left;"><span class="text-block" style="font-weight: initial; font-style: normal; text-decoration: initial; vertical-align: ;">Text bullet 1</span></li>'+
    '	<li class="h-left" style="text-align: left;"><span class="text-block" style="font-weight: initial; font-style: normal; text-decoration: initial; vertical-align: ;">Text bullet 2</span></li>'+
    '</ul>'+
    '<div class="h-left">&nbsp;</div>'+
    '</div></div>';

let self = module.exports = {
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
        //insert the slide
        slideDB.insert(request.payload).then((inserted) => {
            if (co.isEmpty(inserted.ops) || co.isEmpty(inserted.ops[0]))
                throw inserted;
            else{
                //create thumbnail from the newly created slide revision
                let content = inserted.ops[0].revisions[0].content, slideId = inserted.ops[0]._id+'-'+1;
                if(content === ''){
                    content = '<h2>'+inserted.ops[0].revisions[0].title+'</h2>';
                    //for now we use hardcoded template for new slides
                    content = slidetemplate;
                }
                createThumbnail(content, slideId);

                reply(co.rewriteID(inserted.ops[0]));
            }
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    //updates slide by creating a new revision
    updateSlide: function(request, reply) {
        let userId = request.payload.user;
        let slideId = request.params.id;

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
                            tagService.upload(request.payload.tags, request.payload.user).catch( (e) => {
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
                            createThumbnail(content, newSlideId);

                            // update the content item of the parent deck with the new revision id
                            return deckDB.updateContentItem(newSlide, '', request.payload.root_deck, 'slide', request.payload.top_root_deck, userId)
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

    //reverts a slide to a previous revision, w.r.t. a parent deck
    revertSlideRevision: function(request, reply) {
        let userId = request.payload.user;

        slideDB.get(encodeURIComponent(request.params.id.split('-')[0]), request.payload).then((slide) => {
            if (co.isEmpty(slide))
                throw slide;
            else{
                let revision_id = parseInt(request.payload.revision_id);
                //update the content items of the root deck to reflect the slide revert
                return deckDB.updateContentItem(slide, revision_id, request.payload.root_deck, 'slide', request.payload.top_root_deck, userId)
                .then((updatedIds) => {
                    let fullId = request.params.id;
                    if(fullId.split('-').length < 2){
                        fullId += '-'+updatedIds.old_revision;
                    }
                    //update the usage of the reverted slide to point to the root deck
                    return slideDB.updateUsage(fullId, revision_id, request.payload.root_deck).then((updatedSlide) => {
                        let revisionArray = [updatedSlide.revisions[revision_id-1]];
                        updatedSlide.revisions = revisionArray;
                        reply(updatedSlide);
                    });
                });
            }
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    // HACK added this to do the checking and keep original handler intact
    revertSlideRevisionWithCheck: function(request, reply) {
        let userId = request.auth.credentials.userid;

        let parentDeckId = request.payload.root_deck;
        let rootDeckId = request.payload.top_root_deck;

        authorizeUser(userId, parentDeckId, rootDeckId).then((boom) => {
            if (boom) return reply(boom);

            request.payload.user = userId;

            // continue as normal
            self.revertSlideRevision(request, reply);
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });

    },

    //saves the data sources of a slide in the database
    saveDataSources: function(request, reply) {
        let slideId = request.params.id;
        slideDB.saveDataSources(encodeURIComponent(slideId), request.payload.dataSources).then((replaced) => {
            reply(replaced);
        }).catch((error) => {
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
                //create data sources array
                const deckIdParts = request.params.id.split('-');
                const deckRevisionId = (deckIdParts.length > 1) ? deckIdParts[deckIdParts.length - 1] : deck.active;

                if (deck.revisions !== undefined && deck.revisions.length > 0 && deck.revisions[0] !== null) {
                    // add first slide id-revision for all revisions
                    deck.revisions.forEach((rev) => {
                        rev.firstSlide = getFirstSlide(rev);
                    });

                    let deckRevision = deck.revisions.find((revision) => String(revision.id) === String(deckRevisionId));

                    if (deckRevision !== undefined) {
                        //add language of the active revision to the deck
                        if (deckRevision.language){
                            deck.language = deckRevision.language.length === 2 ? deckRevision.language : deckRevision.language.substring(0, 2);
                        }else{
                            deck.language = 'en';
                        }

                        // get dataSources for the deck
                        let dataSources = [];
                        if (deckRevision.contentItems !== undefined) {
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
                                promise = deckDB.getFlatSlidesFromDB(request.params.id, undefined);
                            }

                            promise.then((deckTree) => {
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
                                slideDB.getSelected({selectedIDs: arrayOfSlideIds})// get slides with ids in arrayOfSlideIds
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
                                    deckRevision.dataSources = dataSources;
                                    reply(deck);
                                }).catch((error) => {
                                    console.log('error', error);
                                    reply(deck);
                                });
                            }).catch((error) => {
                                console.log('error', error);
                                reply(deck);
                            });
                        } else {
                            deckRevision.dataSources = [];
                            reply(deck);
                        }
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

    getDeckRevisions: function(request, reply) {
        let deckId = request.params.id; // it should already be a number
        deckDB.get(deckId).then((deck) => {
            if (!deck) return reply(boom.notFound());

            reply(deck.revisions.reverse().map((rev, index, list) => {
                if (!rev.lastUpdate) {
                    // fill in missing lastUpdate from next revision
                    let nextRev = list[index + 1];
                    rev.lastUpdate = (nextRev && nextRev.timestamp) || deck.lastUpdate;
                }

                // keep only deck data
                delete rev.contentItems;
                delete rev.usage;

                return rev;
            }));

        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });

    },

    //creates a new deck in the database
    newDeck: function(request, reply) {
        //insert the deck into the database
        deckDB.insert(request.payload).then((inserted) => {
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
                    let insertPromise = deckDB.insertNewContentItem(insertedSlide.ops[0], 0, newSlide.root_deck, 'slide', 1, top_root_deck, newSlide.user)
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
                    createThumbnail(content, slideId);

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
        let userId = request.payload.user; // use JWT for this

        let deckId = request.params.id;
        // TODO we should keep this required, no fall-back values!
        let rootDeckId = request.payload.top_root_deck;
        authorizeUser(userId, deckId, rootDeckId).then((boom) => {
            // authorizeUser returns nothing if all's ok
            if (boom) return boom;

            // force ignore new_revision
            delete request.payload.new_revision;

            // update the deck without creating a new revision
            return deckDB.update(deckId, request.payload).then((replaced) => {
                if (!replaced) return boom.notFound();

                if (replaced.ok !== 1) throw replaced;
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
        return deckDB.forkAllowed(encodeURIComponent(request.params.id), request.payload.user)
        .then((forkAllowed) => {
            if (!forkAllowed) {
                return reply(boom.forbidden());
            }

            return deckDB.forkDeckRevision(request.params.id, request.payload.user).then((id_map) => {
                reply(id_map);
            });

        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation(error));
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

            // continue as normal
            let parentDeckId = request.payload.root_deck;

            return deckDB.createDeckRevision(deckId, userId, parentDeckId, rootDeckId);
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
            let parentDeckId = request.payload.root_deck;

            return deckDB.revertDeckRevision(deckId, revisionId, userId, parentDeckId, rootDeckId);
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
    },

    //creates a node (deck or slide) into the given deck tree
    createDeckTreeNode: function(request, reply) {
        let node = {};
        let top_root_deck = request.payload.selector.id;
        let userId = request.payload.user;

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

                }
                else{
                    parentID = request.payload.selector.sid;
                }

                let slideArrayPath = spathArray[spathArray.length-1].split(':');
                slidePosition = parseInt(slideArrayPath[1])+1;
                let slideRevision = parseInt(request.payload.nodeSpec.id.split('-')[1])-1;
                self.getSlide({
                    'params' : {'id' : request.payload.nodeSpec.id.split('-')[0]},
                    'log': request.log.bind(request),
                }, (slide) => {
                    if (slide.isBoom) return reply(slide);

                    if(request.payload.nodeSpec.id === request.payload.selector.sid){
                        //we must duplicate the slide
                        let duplicateSlide = slide;
                        if(spathArray.length <= 1)
                            parentID = request.payload.selector.id;

                        duplicateSlide.parent = request.payload.nodeSpec.id;
                        duplicateSlide.comment = 'Duplicate slide of ' + request.payload.nodeSpec.id;
                        //copy the slide to a new duplicate
                        slideDB.copy(duplicateSlide, slideRevision)
                        .then((insertedDuplicate) => {
                            insertedDuplicate = insertedDuplicate.ops[0];
                            insertedDuplicate.id = insertedDuplicate._id;
                            node = {title: insertedDuplicate.revisions[0].title, id: insertedDuplicate.id+'-'+insertedDuplicate.revisions[0].id, type: 'slide'};
                            deckDB.insertNewContentItem(insertedDuplicate, slidePosition, parentID, 'slide', 1, top_root_deck, userId);
                            reply(node);
                        }).catch((err) => {
                            request.log('error', err);
                            reply(boom.badImplementation());
                        });
                    }
                    else{
                        //change position of the existing slide
                        slide.id = slide._id;

                        { // these brackets are kept during handleChange removal to keep git blame under control

                            deckDB.insertNewContentItem(slide, slidePosition, parentID, 'slide', slideRevision+1, top_root_deck, userId);
                            node = {title: slide.revisions[slideRevision].title, id: slide.id+'-'+slide.revisions[slideRevision].id, type: 'slide'};
                            slideDB.addToUsage({ref:{id:slide._id, revision: slideRevision+1}, kind: 'slide'}, parentID.split('-'));

                            reply(node);
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
                            'user': request.payload.user,
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

                        //create the new slide into the database
                        self.newSlide({
                            'payload' : slide,
                            'log': request.log.bind(request),
                        }, (createdSlide) => {
                            if (createdSlide.isBoom) return reply(createdSlide);

                            node = {title: createdSlide.revisions[0].title, id: createdSlide.id+'-'+createdSlide.revisions[0].id, type: 'slide'};
                            deckDB.insertNewContentItem(createdSlide, slidePosition, parentID, 'slide', 1, top_root_deck, userId);
                            //we have to return from the callback, else empty node is returned because it is updated asynchronously
                            reply(node);
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

                            deckDB.insertNewContentItem(deck, deckPosition, parentID, 'deck', deckRevision+1, top_root_deck, userId);
                            deckDB.addToUsage({ref:{id:deck._id, revision: deckRevision+1}, kind: 'deck'}, parentID.split('-'));
                            //we have to return from the callback, else empty node is returned because it is updated asynchronously
                            self.getDeckTree({
                                'params': {'id' : deck.id},
                                'log': request.log.bind(request),
                            }, (deckTree) => {
                                if (deckTree.isBoom) return reply(deckTree);

                                reply(deckTree);
                            });
                        }
                    });
                }
                else{
                    deckDB.forkDeckRevision(request.payload.nodeSpec.id, request.payload.user).then((id_map) => {
                        //console.log('id_map', id_map);
                        //console.log('request payload before', request.payload);
                        request.payload.nodeSpec.id = id_map.id_map[request.payload.nodeSpec.id];

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

                                deckDB.insertNewContentItem(deck, deckPosition, parentID, 'deck', deckRevision+1, top_root_deck, userId);
                                deckDB.addToUsage({ref:{id:deck._id, revision: deckRevision+1}, kind: 'deck'}, parentID.split('-'));
                                //we have to return from the callback, else empty node is returned because it is updated asynchronously
                                self.getDeckTree({
                                    'params': {'id' : deck.id},
                                    'log': request.log.bind(request),
                                }, (deckTree) => {
                                    if (deckTree.isBoom) return reply(deckTree);

                                    reply(deckTree);
                                });
                            }
                        });
                        //reply(id_map);
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
                            'user': request.payload.user,
                            'root_deck': parentID,
                            'top_root_deck': top_root_deck,
                            'position' : deckPosition
                        };
                        //create the new deck
                        self.newDeck({
                            'payload' : deck,
                            'log': request.log.bind(request),
                        }, (createdDeck) => {
                            if (createdDeck.isBoom) return reply(createdDeck);
                            //if there is a parent deck, update its content items
                            if(typeof parentID !== 'undefined')
                                deckDB.insertNewContentItem(createdDeck, deckPosition, parentID, 'deck', 1, top_root_deck, userId);
                            //we have to return from the callback, else empty node is returned because it is updated asynchronously
                            self.getDeckTree({
                                'params': {'id' : createdDeck.id},
                                'log': request.log.bind(request),
                            }, (deckTree) => {
                                if (deckTree.isBoom) return reply(deckTree);

                                reply(deckTree);
                            });
                        });
                    });
                }
            }
        }
    },

    //renames a decktree node (slide or deck)
    renameDeckTreeNode: function(request, reply) {
        //check if it is deck or slide
        if(request.payload.selector.stype === 'deck'){
            let root_deck = request.payload.selector.sid;

            { // these brackets are kept during handleChange removal to keep git blame under control

                let top_root_deck = request.payload.selector.id;
                deckDB.rename(root_deck, request.payload.name, top_root_deck, request.payload.user).then((renamed) => {
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
                    'user' : request.payload.user,
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
                let new_request = {
                    'params' : {'id' :encodeURIComponent(slide_id)},
                    'payload' : new_slide,
                    'log': request.log.bind(request),
                };
                self.updateSlide(new_request, (updated) => {
                    reply(updated);
                });
            });
        }
    },
    //deletes a decktree node by removing its reference from its parent deck (does not actually delete it from the database)
    deleteDeckTreeNode: function(request, reply) {
        let userId = request.payload.user;

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
        //first delete the node from its current position
        self.deleteDeckTreeNode({
            'payload': {'selector' : request.payload.sourceSelector, 'user': request.payload.user, 'isMove' : true},
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
            let payload  = {'payload': {
                'selector' : request.payload.targetSelector, 'nodeSpec': nodeSpec, 'user': request.payload.user, 'isMove' : true},
                'log': request.log.bind(request),
            };
            //append the node (revised or not) in the new position
            self.createDeckTreeNode(payload,
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
        deckDB.getFlatSlidesFromDB(request.params.id, undefined)
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

            reply(deckTree);
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
        deckDB.findWithLimitAndSort('decks', {}, parseInt(request.params.limit), parseInt(request.params.offset), {'timestamp': -1})
        .then((decks) => {
            if (decks.length < 1) {
                reply(boom.notFound());
                return;
            }
            let result = [];
            async.eachSeries(decks, (deck, callback) => {
                let metadata = {};
                metadata._id = deck._id;
                metadata.description = deck.description;
                metadata.countRevisions = deck.revisions.length;
                metadata.active = deck.active;
                metadata.user = deck.user;

                metadata.timestamp = deck.timestamp;
                //get revision
                let revision = deck.revisions[deck.active-1];
                metadata.title = revision.title;
                if (revision.language){
                    metadata.language = revision.language.length === 2 ? revision.language : revision.language.substring(0, 2);
                }else{
                    metadata.language = 'en';
                }
                metadata.firstSlide = getFirstSlide(revision);

                metadata.revision_to_show = revision.id;
                deckDB.getUsernameById(deck.user) //get username
                .then((username) => {
                    metadata.username = username;
                    result.push(metadata);
                    callback();
                })
                .catch((err) => {
                    console.log(err);
                    metadata.username = null;
                    result.push(metadata);
                    callback();
                });
            }, () => {
                return reply(result);
            });
        })
        .catch((err) => {
            console.log(err);
            reply(boom.notFound());
        });
    },

    //gets all featured decks
    getAllFeatured: (request, reply) => {

        if(request.params.offset === 'null'){
            request.params.offset = 0;
        }
        deckDB.findWithLimit('decks', {'revisions.isFeatured': 1}, parseInt(request.params.limit), parseInt(request.params.offset))
        .then((decks) => {
            if (decks.length < 1) {
                reply([]);
                return;
            }
            let result = [];
            async.eachSeries(decks, (deck, callback) => {
                let metadata = {};
                metadata._id = deck._id;
                metadata.description = deck.description;
                metadata.countRevisions = deck.revisions.length;
                metadata.active = deck.active;
                metadata.user = deck.user;

                metadata.timestamp = deck.timestamp;
                //get revision
                let revision = {};
                for (let key in deck.revisions) {
                    if (deck.revisions[key].isFeatured === 1)
                        revision = deck.revisions[key];
                }
                metadata.title = revision.title;
                if (revision.language){
                    metadata.language = revision.language.length === 2 ? revision.language : revision.language.substring(0, 2);
                }else{
                    metadata.language = 'en';
                }

                metadata.firstSlide = getFirstSlide(revision);
                metadata.revision_to_show = revision.id;
                deckDB.getUsernameById(deck.user) //get username
                .then((username) => {
                    metadata.username = username;
                    result.push(metadata);
                    callback();
                })
                .catch((err) => {
                    console.log(err);
                    metadata.username = null;
                    result.push(metadata);
                    callback();
                });
            }, () => {
                return reply(result);
            });
        })
        .catch((err) => {
            console.log(err);
            reply(boom.notFound());
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
                metadata.firstSlide = getFirstSlide(revision);

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

    //counts the slides in a given deck
    countSlides: function(request, reply){
        deckDB.get(request.params.id).then((foundDeck) => {
            if(!foundDeck){
                reply(boom.notFound());
            }
            else{
                let activeRevision = 1;
                if(request.params.id.split('-').length > 1){
                    activeRevision = parseInt(request.params.id.split('-')[1]);
                }
                let slideCount = 0;
                for(let i = 0; i < foundDeck.revisions[activeRevision-1].contentItems.length; i++){
                    if(foundDeck.revisions[activeRevision-1].contentItems[i].kind === 'slide'){
                        slideCount++;
                    }
                }
                reply(slideCount);
            }
        }).catch((err) => {
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
        let operation = (request.payload.operation === 'add') ? deckDB.addTag.bind(deckDB) : deckDB.removeTag.bind(deckDB);

        operation(request.params.id, request.payload.tag).then( (tagsList) => {
            if(!tagsList){
                reply(boom.notFound());
            }
            else{
                // send tags to tag-service
                if(tagsList && tagsList.length > 0){
                    tagService.upload(tagsList, request.payload.user).catch( (e) => {
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
        let operation = (request.payload.operation === 'add') ? slideDB.addTag.bind(slideDB) : slideDB.removeTag.bind(slideDB);

        operation(request.params.id, request.payload.tag).then( (tagsList) => {
            if(!tagsList){
                reply(boom.notFound());
            }
            else{
                // send tags to tag-service
                if(tagsList && tagsList.length > 0){
                    tagService.upload(tagsList, request.payload.user).catch( (e) => {
                        request.log('warning', 'Could not save tags to tag-service for slide ' + request.params.id + ': ' + e.message);
                    });
                }

                reply(tagsList);
            }
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    }
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

// get first slide
function getFirstSlide(revision) {
    // TODO two bugs in this code just by looking at it,
    // (1) it assumes first contentItem is slide
    // (2) it assumes there's at least one slide in contentItems, could be in subdecks
    // (3) it keeps iteration even though it found it
    let firstSlide;
    for (let key in revision.contentItems) {
        if (revision.contentItems[key].order === 1
            && revision.contentItems[key].kind === 'slide') {
            firstSlide = revision.contentItems[key].ref.id;

            if (revision.contentItems[key].ref.revision) {
                firstSlide += '-' + revision.contentItems[key].ref.revision;
            }
        }
    }

    return firstSlide;
}

//creates a thumbnail for a given slide
function createThumbnail(slideContent, slideId) {
    let rp = require('request-promise-native');
    let he = require('he');

    let encodedContent = he.encode(slideContent, {allowUnsafeSymbols: true});

    rp.post({
        uri: Microservices.file.uri + '/slideThumbnail/' + slideId, //is created as slideId.jpeg
        body: encodedContent,
        headers: {
            'Content-Type': 'text/plain'
        }
    }).catch((e) => {
        console.log('Can not create thumbnail of a slide: ' + e.message);
    });
}
