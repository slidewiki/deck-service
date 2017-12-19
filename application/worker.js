'use strict';

let agenda_file = require('./lib/agenda.js');

agenda_file.getAgenda().then((agenda) => {
    agenda_file.startAgenda(agenda);
    agenda.on('start', (job) => {
        console.log('Job %s started for deck %s', job.attrs.name, job.attrs.data.deckId);
    });
    agenda.on('success', (job) => {
        console.log('Job %s completed successfully for deck %s', job.attrs.name, job.attrs.data.deckId);
    });
    agenda.on('fail', (err, job) => {
        console.log('Job %s failed with error %s for deck %s', job.attrs.name, err.message, job.attrs.data.deckId);
    });
}).catch((err) => {
    console.log('Worker caught a fatal error and will stop:');
    console.log(err);
    process.exit(-1);
});
