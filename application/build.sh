#!/bin/bash

# Get the current date in YYYYMMDD format
TAG=$(date +%Y%m%d)

# Set the image name with the tag
IMAGE_NAME="mhuang74/infinite-worship-arm64:$TAG"
echo "Building image: $IMAGE_NAME for linux/arm64"

# Build the docker image using docker-compose
# The --pull argument ensures we get the latest base images
DOCKER_DEFAULT_PLATFORM=linux/arm64 docker-compose build --pull app

ECR_REPO="public.ecr.aws/u4p9h6o7/mhuang74/infinite-worship"

echo "Tagging image for AWS ECR..."
docker tag "$IMAGE_NAME" "$ECR_REPO:$TAG"
docker tag "$IMAGE_NAME" "$ECR_REPO:latest"

echo "Log into AWS ECR..."
aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws/u4p9h6o7

echo "Pushing image to AWS ECR..."
docker push "$ECR_REPO:$TAG"
docker push "$ECR_REPO:latest"

echo "Build and push complete."
