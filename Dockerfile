# This Dockerfile is used to set up a container environment with all the required
# tools to use this project. You only need to provide the necessary environment
# variables, as described in the README.
#
# Docker version that I used: 20.10.17
#
# If you're interested in testing other base images, take a look at this reference:
# https://github.com/BretFisher/nodejs-rocks-in-docker
FROM node:16-bullseye-slim

ARG USERNAME=migrator
ARG USER_UID=2000
ARG USER_GID=$USER_UID

LABEL version="0.1.5"
LABEL description="Migrate Issues, Wiki from gitlab to github."

WORKDIR /app

# Add a non-root user, so later we can explore methods to scale
# privileges within this container.
# https://code.visualstudio.com/remote/advancedcontainers/add-nonroot-user#_creating-a-nonroot-user
RUN groupadd --gid $USER_GID $USERNAME
RUN useradd --uid $USER_UID --gid $USER_GID -m $USERNAME
RUN chown -R $USERNAME /app

# Copy the project contents to the container
COPY --chown=$USERNAME . /app

USER $USERNAME

# Install dependencies
RUN npm i

# Start the process
ENTRYPOINT ["/bin/bash", "-c", "npm run start"]