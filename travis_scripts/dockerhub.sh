#!/bin/bash

docker login -u="$DOCKER_USERNAME" -p="$DOCKER_PASSWORD"
docker build--build-arg BUILD_ENV=travis -t slidewiki/deckservice:latest-dev ./
docker push slidewiki/deckservice:latest-dev
