'use strict';

const hapi = require('hapi');
const JWT = require('jsonwebtoken');

const helper = require('./database/helper');

const secret = 'NeverShareYourSecret';

const server = new hapi.Server();
server.connection({
    host: '0.0.0.0',
    port: 3030,
});

// just do the init once
const init = new Promise((resolve, reject) => {
    server.register([require('hapi-auth-jwt2')], (err) => {
        if (err) return reject(err);

        server.auth.strategy('jwt', 'jwt', {
            key: secret,
            validateFunc: (decoded, request, callback) => {callback(null, true);},
            verifyOptions: {
                ignoreExpiration: true
            },
            headerKey: '----jwt----',
        });

        require('./routes.js')(server);

        // graceful shutdown
        server.on({
            name: 'stop',
            block: true,
        }, (payload, done) => {
            // clean up database connections
            helper.closeConnection().catch((err) => {
                console.warn('error while closing db connections: ', err);
            }).then(() => done());
        });

        // clean up database when first starting the server
        resolve(helper.cleanDatabase().then(() => server));
    });
});


module.exports = {
    init: () => init,
    tokenFor: (userid) => JWT.sign( { userid }, secret),
};
