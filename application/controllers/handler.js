/*
Handles the requests by executing stuff and replying to the client. Uses promises to get stuff done.
*/
/* eslint promise/always-return: "off" */



'use strict';

const _ = require('lodash');
const util = require('../lib/util');

const boom = require('boom'),
    slideDB = require('../database/slideDatabase'),
    deckDB = require('../database/deckDatabase'),
    treeDB = require('../database/deckTreeDatabase'),
    co = require('../common'),
    Joi = require('joi'),
    async = require('async');

const tagService = require('../services/tag');
const fileService = require('../services/file');

const auth = require('./auth');

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

    // gets a single slide with all of its revisions, unless revision is defined
    getSlide: async function(request, reply) {
        let slideId = request.params.id;
        let rootId = request.query.root;

        try {
            let slide = await slideDB.get(slideId);
            if (!slide) {
                throw boom.notFound();
            }

            if (rootId) {
                let path = await deckDB.findPath(rootId, slideId, 'slide');
                if (!_.isEmpty(path)) {
                    let { tags } = await deckDB.collect(path, [], ['tags']);
                    // could be duplicates
                    slide.pathTags = _.uniqBy(tags, 'tagName');
                } else {
                    throw boom.badData(`could not find slide: ${slideId} in deck tree: ${rootId}`);
                }
            }

            reply(slide);
        } catch (err) {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        }
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

    // inserts a new slide into the database
    newSlide: function(request, reply) {
        let userId = request.auth.credentials.userid;

        // insert the slide
        slideDB.insert(request.payload, userId).then((inserted) => {
            // empty results means something wrong with the payload
            if (!inserted) throw boom.badData();

            let createdSlide = co.rewriteID(inserted);

            // create thumbnail from the newly created slide revision
            let content = createdSlide.revisions[0].content, slideId = createdSlide.id+'-'+1;
            // themeless
            fileService.createThumbnail(content, slideId).catch((err) => {
                request.log('warn', `could not create thumbnail for new slide ${slideId}: ${err.message || err}`);
            });

            return createdSlide;

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    // updates slide by creating a new revision
    updateSlideNode: function(request, reply) {
        let slideId = request.params.id;

        // ignore the language (TODO remove from API as well)
        delete request.payload.language;

        slideDB.exists(slideId).then((exists) => {
            if (!exists) throw boom.notFound();

            let rootId = request.payload.top_root_deck;
            return slideDB.findSlideNode(rootId, slideId).then((slideNode) => {
                if (!slideNode) {
                    throw boom.badData(`could not find slide: ${slideId} in deck tree: ${rootId}`);
                }

                let userId = request.auth.credentials.userid;
                let parentDeckId = util.toIdentifier(slideNode.parent);
                return auth.authorizeUser(userId, parentDeckId, rootId).then((boomError) => {
                    if (boomError) throw boomError;

                    return slideDB.updateSlideNode(slideNode, request.payload, userId).then((slideRef) => {
                        // send tags to tag-service
                        if (request.payload.tags && request.payload.tags.length > 0) {
                            tagService.upload(request.payload.tags, userId).catch( (e) => {
                                request.log('warning', 'Could not save tags to tag-service for slide ' + slideId + ': ' + e.message);
                            });
                        }

                        // we must update all decks in the 'usage' attribute
                        return slideDB.get(slideRef.id).then((newSlide) => {
                            // prepare the newSlide response object
                            newSlide.revisions = [_.find(newSlide.revisions, { id: slideRef.revision })];

                            let content = newSlide.revisions[0].content;
                            let newSlideId = util.toIdentifier(slideRef);
                            // create thumbnail for the new slide revision
                            fileService.createThumbnail(content, newSlideId, slideRef.theme).catch((err) => {
                                console.warn(`could not create thumbnail for updated slide ${newSlideId}, error was: ${err.message}`);
                            });

                            newSlide.theme = slideRef.theme;
                            return newSlide;
                        });
                    });
                });
            });

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    // reverts a slide to a previous revision, w.r.t. a parent deck
    revertSlideRevision: function(request, reply) {
        let slideId = request.params.id;

        slideDB.exists(slideId).then((exists) => {
            if (!exists) throw boom.notFound();

            let rootId = request.payload.top_root_deck;
            // we need to find the slide node in the tree!
            return slideDB.findSlideNode(rootId, slideId).then((slideNode) => {
                // could not find path due to bad payload
                if (!slideNode) {
                    throw boom.badData(`could not find slide: ${slideId} in deck tree: ${rootId} `);
                }

                let userId = request.auth.credentials.userid;
                let parentDeckId = util.toIdentifier(slideNode.parent);
                return auth.authorizeUser(userId, parentDeckId, rootId).then((boomError) => {
                    if (boomError) throw boomError;

                    let revisionId = parseInt(request.payload.revision_id);
                    return slideDB.revertSlideNode(slideNode, revisionId, userId).then((slideRef) => {
                        // if revert returns nothing, it's not because of 404, but no path was found!
                        if (!slideRef) {
                            throw boom.badData(`unknown revision id: ${revisionId} for slide: ${slideId}`);
                        }

                        let revertedSlideId = util.toIdentifier(slideRef);
                        return slideDB.get(revertedSlideId).then((updatedSlide) => {
                            // keep only the new slide revision in revisions array for response
                            let slideRevision = _.find(updatedSlide.revisions, { id: revisionId });
                            updatedSlide.revisions = [slideRevision];

                            // also, create a thumbnail with the parent deck's theme
                            fileService.createThumbnail(slideRevision.content, revertedSlideId, slideRef.theme).catch((err) => {
                                console.warn(`could not create thumbnail for reverted slide ${revertedSlideId}, error was: ${err.message}`);
                            });

                            return updatedSlide;
                        });

                    });

                });

            });

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    //saves the data sources of a slide in the database
    saveSlideDataSources: function(request, reply) {
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
    
    //saves the data sources of a deck in the database
    saveDeckDataSources: function(request, reply) {
        let deckId = request.params.id;
        deckDB.get(deckId).then( (deck) => {
            if(!deck) return reply(boom.notFound());

            return deckDB.saveDataSources(deckId, request.payload).then((dataSources) => {
                reply(dataSources);
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
    
    getSlideAnnotations: function(request, reply) {
        let slideId = request.params.id;
        slideDB.get(slideId).then((slide) => {
            if(!slide) return reply(boom.notFound());

            let items = slide.revisions[0].annotations || [];
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

            // variant (translations) filter
            let variantFilter = _.pick(request.query, 'language');

            let dataSources = [];
            if (deckRevision.dataSources) {//add deck datasources
                deckRevision.dataSources.forEach((dataSource) => {
                    dataSources.push(dataSource);
                });
            }
            let arrayOfSlideIds = [];
            let slideRevisionsMap = {};

            let arrayOfDeckIds = [];
            let deckRevisionsMap = {};

            return treeDB.getDeckTree(request.params.id, variantFilter).then((deckTree) => {
                let children = deckTree.children;
                for (let i = 0; i < children.length; i++) {
                    let child = children[i];
                    if (child.type === 'slide') {
                        let idArray = child.id.split('-');
                        const newSlideId = parseInt(idArray[0]);
                        const newSlideRevisionId = parseInt(idArray[1]);
                        if (!(newSlideId in slideRevisionsMap)) {
                            arrayOfSlideIds.push(newSlideId);
                            slideRevisionsMap[newSlideId] = newSlideRevisionId;
                        }
                    } else {
                        let idArray = child.id.split('-');
                        const newDeckId = parseInt(idArray[0]);
                        const newDeckRevisionId = parseInt(idArray[1]);
                        if (!(newDeckId in deckRevisionsMap)) {
                            arrayOfDeckIds.push(newDeckId);
                            deckRevisionsMap[newDeckId] = newDeckRevisionId;
                        }
                        
                        children.concat(child.children);
                    }
                }
            }).then(() => {
                // get dataSources for slides
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
                                        dataSource.stype = 'slide';
                                        dataSources.push(dataSource);
                                    }
                                });
                            }
                        }
                    });
                }).then(() => {
                    if (arrayOfDeckIds.length > 0) {
                        // get dataSources for decks
                        return deckDB.getSelected({selectedIDs: arrayOfDeckIds})// get decks with ids in arrayOfDeckIds
                        .then((decks) => {
                            decks.forEach((deck) => {
                                if (deck.revisions !== undefined && deck.revisions.length > 0 && deck.revisions[0] !== null) {
                                    const deckId = deck._id;
                                    const deckRevisionId = deckRevisionsMap[deckId];
                                    let deckRevision = deck.revisions.find((revision) =>  String(revision.id) ===  String(deckRevisionId));
                                    if (deckRevision !== undefined && deckRevision.dataSources !== null && deckRevision.dataSources !== undefined) {
                                        const deckRevisionTitle = deckRevision.title;
                                        deckRevision.dataSources.forEach((dataSource) => {
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
                                                dataSource.sid = deckId + '-' + deckRevisionId;// add info about the origin
                                                dataSource.stitle = deckRevisionTitle;
                                                dataSource.stype = 'deck';
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
                    } else {
                        let items = dataSources;
                        let totalCount = items.length;
                        if (request.query.countOnly) {
                            items = [];
                        }
                        reply({ items, totalCount, revisionOwner: deckRevision.user });
                    }
                });
            });

        }).catch((error) => {
            if (error.isBoom) return reply(error);

            request.log('error', error);
            reply(boom.badImplementation());
        });

    },

    // gets a single deck from the database, containing all revisions, unless a specific revision is specified in the id
    getDeck: async function(request, reply) {
        let deckId = request.params.id;
        let variantFilter = _.pick(request.query, 'language');

        let fallbackFilter, pathTags;
        if (request.query.root && request.query.root !== deckId) {
            let node = await treeDB.findDeckTreeNode(request.query.root, deckId, 'deck');
            if (node) {
                let rootDeck = await deckDB.getDeck(request.query.root);
                fallbackFilter = _.pick(rootDeck, 'language');

                // also collect the tags
                let { tags } = await deckDB.collect(node.path, [], ['tags']);
                // could be duplicates
                pathTags = _.uniqBy(tags, 'tagName');
            } else {
                throw boom.badData(`could not find deck: ${deckId} in deck tree: ${request.query.root}`);
            }
        }

        let deck = await deckDB.get(deckId, variantFilter, fallbackFilter);
        if (!deck) throw boom.notFound();

        try {
            // TODO this is only until we remove the damned revisions array from response payload
            // the last is the selected one, or the latest one
            let [defaultRevision] = deck.revisions.slice(-1);
            deck.language = defaultRevision.language;

            // add some deprecated names for revision, latestRevision
            let deckRef = util.parseIdentifier(deckId);
            if (deckRef.revision) {
                deck.revisionId = defaultRevision.id;
                // TODO remove this, not really latest
                deck.latestRevisionId = defaultRevision.id;
            } else {
                // default to active (?)
                deck.revisionId = deck.active;
                deck.latestRevisionId = defaultRevision.id;
            }

            // add first slide id-revision for all revisions
            for (let rev of deck.revisions) {
                let deckRev = {
                    id: deck._id,
                    revision: rev.id,
                    language: rev.language,
                    contentItems: rev.contentItems,
                };
                rev.firstSlide = await treeDB.getFirstSlide(deckRev);
            }

            // also add the pathTags
            if (pathTags) {
                deck.pathTags = pathTags;
            }

            reply(deck);

        } catch (err) {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        }
    },

    getDeckRevisions: function(request, reply) {
        let deckId = request.params.id; // it should already be a number

        deckDB.get(deckId).then((deck) => {
            if (!deck) throw boom.notFound();

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
        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    // creates a new deck in the database
    newDeck: function(request, reply) {
        let userId = request.auth.credentials.userid;

        // insert the deck into the database
        deckDB.insert(request.payload, userId).then((inserted) => {
            // empty results means something wrong with the payload
            if (!inserted) throw boom.badData();
            let newDeckId = String(inserted._id) + '-1';

            if (request.payload.empty) {
                // skip creating a new slide
                return co.rewriteID(inserted);
            }

            // create a new slide inside the new deck
            let newSlide = Object.assign({
                // defaults
                title: 'New slide',
                content: slidetemplate,
                markdown: '',
                speakernotes: '',
            }, _.pick(request.payload, [
                'language',
                'license',
            ]), _.pick(request.payload.first_slide, [
                'title',
                'content',
                'markdown',
                'speakernotes',
            ]));

            if (request.payload.slideDimensions) {
                newSlide.dimensions = request.payload.slideDimensions;
            }

            return treeDB.createSlide(newSlide, newDeckId, 0, newDeckId, userId)
            .then(() => co.rewriteID(inserted));

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation(err));
        });
    },

    // new simpler implementation of deck update with permission checking and NO new_revision: true option
    updateDeck: function(request, reply) {
        let userId = request.auth.credentials.userid;
        let deckId = request.params.id;
        // TODO we should keep this required, no fall-back values!
        let rootDeckId = request.payload.top_root_deck;
        auth.authorizeUser(userId, deckId, rootDeckId).then((boom) => {
            // authorizeUser returns nothing if all's ok
            if (boom) throw boom;

            // force ignore new_revision
            delete request.payload.new_revision;

            // include user id in the payload!
            request.payload.user = userId;

            // update the deck without creating a new revision
            return deckDB.update(deckId, request.payload).then((result) => {
                if (!result) throw boom.notFound();
                let {replaced, changed} = result;

                // send tags to tag-service
                if (!_.isEmpty(request.payload.tags)) {
                    tagService.upload(request.payload.tags, userId).catch((e) => {
                        request.log('warning', 'Could not save tags to tag-service for deck ' + request.params.id + ': ' + e.message);
                    });
                }

                if (!changed.theme) return replaced;

                // theme was changed, update thumbs for all direct slides
                return slideDB.getDeckSlides(deckId).then((slides) => {
                    for (let slide of slides) {
                        let slideId = util.toIdentifier(slide);
                        fileService.createThumbnail(slide.content, slideId, changed.theme).catch((err) => {
                            console.warn(`could not update thumbnail for slide ${slideId}, error was: ${err.message}`);
                        });
                    }

                    return replaced;
                }).catch((err) => {
                    console.warn(`could not update slide thumbnails for deck ${deckId}, error was: ${err.message}`);
                });

            });

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    getDeckVariants: function(request, reply){
        deckDB.getDeckVariants(request.params.id).then((variants) => {
            if (!variants) return reply(boom.notFound());
            reply(variants);
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    addDeckVariant: function(request, reply) {
        let userId = request.auth.credentials.userid;
        let deckId = request.params.id;

        auth.authorizeUser(userId, deckId, deckId).then((boom) => {
            // authorizeUser returns nothing if all's ok
            if (boom) throw boom;

            // reply new variant data on success
            return deckDB.addDeckVariant(deckId, request.payload, userId);
        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
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
                    'hidden',
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

            return treeDB.copyDeckTree(deckId, userId).then((id_map) => {
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

        auth.authorizeUser(userId, deckId, rootDeckId).then((boom) => {
            // authorizeUser returns nothing if all's ok
            if (boom) throw boom;

            return deckDB.createDeckRevision(deckId, userId, rootDeckId);
        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    // reverts a deck into a past revision
    revertDeckRevision: function(request, reply) {
        let userId = request.auth.credentials.userid;

        let deckId = request.params.id;
        let rootDeckId = request.payload.top_root_deck;

        auth.authorizeUser(userId, deckId, rootDeckId).then((boom) => {
            // authorizeUser returns nothing if all's ok
            if (boom) throw boom;

            // continue as normal
            let revisionId = request.payload.revision_id;

            return deckDB.revertDeckRevision(deckId, revisionId, userId, rootDeckId)
            .then((updatedDeck) => {
                // means the revision_id in the payload was invalid
                if (!updatedDeck) {
                    throw boom.badData(`could not find ${revisionId} for deck ${deckId}`);
                }

                return updatedDeck;
            });

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    //gets the decktree with the given deck as root
    getDeckTree: function(request, reply) {
        if(request.query && request.query.enrich) {
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
            treeDB.getDeckTree(request.params.id, _.pick(request.query, 'language'))
            .then((deckTree) => {
                if (!deckTree) return reply(boom.notFound());

                if (co.isEmpty(deckTree))
                    reply(boom.notFound());
                else{
                    reply(deckTree);
                }
            }).catch((err) => {
                if(err.isBoom) return reply(err);

                request.log('error', err);
                reply(boom.badImplementation());
            });
        }
    },

    getDeckTreeNodeVariants: function(request, reply) {
        let rootDeckId = request.query.id;

        // only doing this to return proper http error
        return deckDB.getDeck(rootDeckId).then((rootDeck) => {
            if (!rootDeck) throw boom.notFound();

            if (!request.query.sid || request.query.stype === 'deck') {
                // TODO check if node exists

                let deckId = request.query.sid || request.query.id;
                return deckDB.getDeckVariants(deckId);
            }

            let slideId = request.query.sid;
            return slideDB.findSlideNode(rootDeckId, slideId).then((slideNode) => {
                if (!slideNode) {
                    throw boom.badData(`could not find slide: ${slideId} in deck tree: ${rootDeckId}`);
                }

                // also add the original slide in the response
                return [Object.assign({
                    original: true
                }, _.pick(slideNode.slide, 'id', 'revision', 'language')),
                ...slideNode.variants];
            });

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    addDeckTreeNodeVariant: function(request, reply) {
        let userId = request.auth.credentials.userid;
        let {id: rootDeckId} = util.parseIdentifier(request.payload.selector.id);
        // will ignore any revision included here

        // TODO proper authorization checking the actual parent id
        return auth.authorizeUser(userId, rootDeckId, rootDeckId).then((boomError) => {
            if (boomError) throw boomError;

            // let's only worry about slides for now
            if (request.payload.selector.stype !== 'slide') {
                throw boom.badData('adding translations to a subdeck is not supported');
            }

            // locate the node
            let slideId = request.payload.selector.sid;
            return slideDB.findSlideNode(rootDeckId, slideId).then((slideNode) => {
                if (!slideNode) {
                    throw boom.badData(`could not find slide: ${slideId} in deck tree: ${rootDeckId}`);
                }

                // check if node variant exists already
                let variantFilter = _.pick(request.payload, 'language');
                if (_.find(slideNode.variants, variantFilter) ) {
                    throw boom.badData(`variant for ${Object.entries(variantFilter)} already exists for slide: ${slideId} in deck tree: ${rootDeckId}`);
                }

                return slideDB.addSlideNodeVariant(slideNode, request.payload, userId).then((newVariant) => {
                    // also create a thumbnail
                    let newSlideId = util.toIdentifier(newVariant);
                    // content is the same as the primary slide
                    fileService.createThumbnail(slideNode.slide.content, newSlideId, slideNode.parent.theme).catch((err) => {
                        console.warn(`could not create thumbnail for new slide variant ${newSlideId}, error was: ${err.message}`);
                    });

                    return newVariant;
                });
            });

        }).then((result) => {
            // after all is said and done, reply!
            reply(result);
        }).catch((err) => {
            if (err.isBoom) return reply(err);

            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    //gets a flat listing of the slides from deck and all of its sub-decks with optional offset and limit
    getFlatSlides: function(request, reply){
        treeDB.getFlatSlides(request.params.id, _.pick(request.query, 'language'))
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

    // returns the users and groups authorized for editing the deck
    getEditors: function(request, reply){
        let deckId = request.params.id;

        deckDB.get(deckId).then((deck) => {
            if (!deck) return reply(boom.notFound());

            let {users, groups} = deck.editors || {};
            if (!users) users = [];
            if (!groups) groups = [];

            reply({ editors: {users, groups} });

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

    requestEditRights: function(request, reply) {
        let deckId = request.params.id;
        let userId = request.auth.credentials.userid;

        deckDB.userPermissions(deckId, userId).then((perm) => {
            if (!perm) throw boom.notFound();

            if (perm.edit) {
                // user already has permissions, return error
                throw boom.badData();
            }

            return deckDB.addEditRightsRequest(deckId, userId);

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
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

    // gets all recent decks
    getAllRecent: async function(request, reply) {
        let limit = parseInt(request.params.limit);
        let offset = parseInt(request.params.offset);

        try {
            let recentDecks = await deckDB.getAllRecent(limit, offset);
            if(!recentDecks) return reply([]);

            let countForksIds = new Set();
            // collect deck ids to count forks needed
            recentDecks.forEach( (deck) => {
                countForksIds.add(deck._id);
            });
            // count deck forks for the above deck ids
            let forkCounts = {};
            let forkCountsInfo = await deckDB.countManyDeckForks([...countForksIds]);
            forkCountsInfo.forEach( (forkCount) => {
                forkCounts[forkCount._id] = forkCount.forkCount;
            });

            let result = [];
            for (let deck of recentDecks) {
                // get active revision
                let activeRevision = deck.revisions.find((rev) => (rev.id === deck.active));
                if(!activeRevision) continue;

                // get latest revision
                let [latestRevision] = deck.revisions.slice(-1);

                // this is needed for getFirstSlide to work
                let activeDeckRev = {
                    id: deck._id,
                    revision: activeRevision.id,
                    language: activeRevision.language,
                    contentItems: activeRevision.contentItems,
                };

                result.push({
                    _id: deck._id,
                    title: activeRevision.title,
                    description: deck.description,
                    user: deck.user,
                    active: deck.active,
                    countRevisions: deck.revisions.length,
                    timestamp: deck.timestamp,
                    language: (activeRevision.language) ? activeRevision.language.substring(0, 2) : 'en',
                    forkCount: (forkCounts[deck._id]) ? forkCounts[deck._id] : 0,
                    theme: activeRevision.theme,
                    firstSlide: await treeDB.getFirstSlide(activeDeckRev),
                    revisionId: activeRevision.id,
                    latestRevisionId: latestRevision.id
                });
            }

            reply(result);

        } catch (err) {
            request.log('error', err);
            reply(boom.badImplementation());
        }

    },

    // gets all featured decks
    getAllFeatured: async function(request, reply) {
        let limit = parseInt(request.params.limit);
        let offset = parseInt(request.params.offset);

        try {
            let featuredDecks = await deckDB.getAllFeatured(limit, offset);
            if(!featuredDecks) return reply([]);

            let countForksIds = new Set();
            // collect deck ids to count forks needed
            featuredDecks.forEach( (deck) => {
                countForksIds.add(deck._id);
            });
            // count deck forks for the above deck ids
            let forkCounts = {};
            let forkCountsInfo = await deckDB.countManyDeckForks([...countForksIds]);
            forkCountsInfo.forEach( (forkCount) => {
                forkCounts[forkCount._id] = forkCount.forkCount;
            });

            let result = [];
            for (let deck of featuredDecks) {
                // get active revision
                let activeRevision = deck.revisions.find((rev) => (rev.id === deck.active));
                if(!activeRevision) continue;

                // get latest revision
                let [latestRevision] = deck.revisions.slice(-1);

                // this is needed for getFirstSlide to work
                let activeDeckRev = {
                    id: deck._id,
                    revision: activeRevision.id,
                    language: activeRevision.language,
                    contentItems: activeRevision.contentItems,
                };

                result.push({
                    _id: deck._id,
                    title: activeRevision.title,
                    description: deck.description,
                    user: deck.user,
                    active: deck.active,
                    countRevisions: deck.revisions.length,
                    timestamp: deck.timestamp,
                    language: (activeRevision.language) ? activeRevision.language.substring(0, 2) : 'en',
                    forkCount: (forkCounts[deck._id]) ? forkCounts[deck._id] : 0,
                    theme: activeRevision.theme,
                    firstSlide: await treeDB.getFirstSlide(activeDeckRev),
                    revisionId: activeRevision.id,
                    latestRevisionId: latestRevision.id
                });
            }

            reply(result);

        } catch (err) {
            request.log('error', err);
            reply(boom.badImplementation());
        }

    },

    //returns metadata about all decks a user owns
    getAllDecks: async (request, reply) => {
        //TODO another API for user activity is needed

        //parse userid
        let userid = request.params.userid;
        const integerSchema = Joi.number().integer();
        const validationResult = integerSchema.validate(userid);
        if (validationResult.error === null) {
            userid = validationResult.value;
        }

        let decks = await deckDB.find('decks', {
            user: userid,
            hidden: { $in: [false, null] },
        });

        try {
            let result = [];

            for (let deck of decks) {
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
                metadata.theme = revision.theme;

                // get first slide
                let deckRev = {
                    id: deck._id,
                    revision: revision.id,
                    language: revision.language,
                    contentItems: revision.contentItems,
                };
                metadata.firstSlide = await treeDB.getFirstSlide(deckRev);

                result.push(metadata);
            }

            reply(result);

        } catch(err) {
            request.log('error', err);
            reply(boom.badImplementation());
        }

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
            if (!existingDeck) throw boom.notFound();

            return deckDB.getUsage(deckId);

            /* eslint-disable no-unreachable */
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
            /* eslint-enable no-unreachable */
        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    getDeckRootDecks: function(request, reply){
        let deckId = request.params.id;
        let deck = util.parseIdentifier(deckId) || {};
        deckDB.get(deck.id).then((existingDeck) => {
            if (!existingDeck) throw boom.notFound();

            return deckDB.getRootDecks(deckId)
            .then((roots) => {
                return roots;
                /* eslint-disable no-unreachable */
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
                /* eslint-enable no-unreachable */
            });

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    getSlideUsage: function(request, reply) {
        let slideId = request.params.id;
        let slide = util.parseIdentifier(slideId);
        slideDB.get(slide.id).then((existingSlide) => {
            if (!existingSlide) throw boom.notFound();

            return deckDB.getUsage(slideId, 'slide');

            /* eslint-disable no-unreachable */
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
            /* eslint-enable no-unreachable */
        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    getSlideRootDecks: function(request, reply){
        let slideId = request.params.id;
        let slide = util.parseIdentifier(slideId);
        slideDB.get(slide.id).then((existingSlide) => {
            if (!existingSlide) throw boom.notFound();

            return deckDB.getRootDecks(slideId, 'slide').then((roots) => {
                return roots;
                /* eslint-disable no-unreachable */
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
                /* eslint-disable no-unreachable */

            });
        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
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

        auth.authorizeUser(userId, deckId, rootDeckId).then((boomError) => {
            if (boomError) throw boomError;

            return deckDB.get(deckId).then( (deck) => {
                if(!deck) throw boom.notFound();

                return deckDB.replaceTags(deckId, request.payload.tags, userId, rootDeckId).then((updatedDeck) => {
                    return updatedDeck;
                });
            });
        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
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
        treeDB.getMedia(request.params.id, request.query.mediaType).then( (deckMedia) => {
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

        treeDB.getFlatSlides(deckId).then((deckTree) => {
            if (!deckTree) return reply(boom.notFound());

            async.concatSeries(deckTree.children, (slide, done) => {
                if (!slide.content) {
                    slide.content = `<h2>${slide.title}</h2>`;
                }

                fileService.createThumbnail(slide.content, slide.id, slide.theme, request.query.force).then(() => {
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
        if (perms.some((p) => p === undefined)) return boom.badData(`could not authorize user:${userId} for deck:${deckId} under tree:${rootDeckId}`);

        // check edit permission
        if (perms.some((p) => !p.edit)) return boom.forbidden();

        // check readOnly status
        if (perms.some((p) => p.readOnly)) return boom.forbidden();

        // return nothing if all's ok :)
    });

}
