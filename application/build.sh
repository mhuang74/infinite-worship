#!/bin/bash

# Get the current date in YYYYMMDD format
TAG=$(date +%Y%m%d)

# Set the image name with the tag
export IMAGE_NAME="mhuang74/infinite-worship-arm64:$TAG"
export DOCKER_IMAGE="infinite-worship"

echo "Building image: $IMAGE_NAME for linux/arm64"

# Build the docker image using docker-compose
# The --pull argument ensures we get the latest base images
DOCKER_DEFAULT_PLATFORM=linux/arm64 docker-compose build --pull app

echo "Tagging image..."
docker tag "${DOCKER_IMAGE}_app:latest" "$IMAGE_NAME"

echo "Pushing image to Docker Hub..."
docker push "$IMAGE_NAME"

echo "Build and push complete."
