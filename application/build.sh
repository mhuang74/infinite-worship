#!/bin/bash

# Get the current date in YYYYMMDD format
TAG=$(date +%Y%m%d)

# Set the image names with the tag
export TAG
export BACKEND_IMAGE_NAME="infinite-worship-backend-arm64"
export FRONTEND_IMAGE_NAME="infinite-worship-frontend-arm64"

# Set build argument to force frontend rebuild
export BUILD_ARG=$(date +%s)

echo "Building images for linux/arm64 with tag: $TAG"

# Build the docker images using docker-compose
# The --pull argument ensures we get the latest base images
(DOCKER_DEFAULT_PLATFORM=linux/arm64 docker-compose build --pull)

ECR_REGISTRY="public.ecr.aws/u4p9h6o7"
ECR_REPOSITORY="mhuang74/infinite-worship"

echo "Tagging images for AWS ECR..."
docker tag "$BACKEND_IMAGE_NAME:$TAG" "$ECR_REGISTRY/$ECR_REPOSITORY:$BACKEND_IMAGE_NAME-$TAG"
docker tag "$BACKEND_IMAGE_NAME:$TAG" "$ECR_REGISTRY/$ECR_REPOSITORY:$BACKEND_IMAGE_NAME-latest"
docker tag "$FRONTEND_IMAGE_NAME:$TAG" "$ECR_REGISTRY/$ECR_REPOSITORY:$FRONTEND_IMAGE_NAME-$TAG"
docker tag "$FRONTEND_IMAGE_NAME:$TAG" "$ECR_REGISTRY/$ECR_REPOSITORY:$FRONTEND_IMAGE_NAME-latest"

echo "Log into AWS ECR..."
aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin "$ECR_REGISTRY"

echo "Pushing images to AWS ECR..."
docker push "$ECR_REGISTRY/$ECR_REPOSITORY:$BACKEND_IMAGE_NAME-$TAG"
docker push "$ECR_REGISTRY/$ECR_REPOSITORY:$BACKEND_IMAGE_NAME-latest"
docker push "$ECR_REGISTRY/$ECR_REPOSITORY:$FRONTEND_IMAGE_NAME-$TAG"
docker push "$ECR_REGISTRY/$ECR_REPOSITORY:$FRONTEND_IMAGE_NAME-latest"

echo "Build and push complete."
