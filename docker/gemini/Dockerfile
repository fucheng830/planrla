FROM docker/sandbox-templates:gemini

USER root
COPY shared/install-nomad.sh /tmp/install-nomad.sh
RUN chmod +x /tmp/install-nomad.sh && /tmp/install-nomad.sh

USER agent
RUN npm install -g nomad && nomad --version

COPY --chown=agent:agent shared/start-nomad.sh /home/agent/.nomad-start.sh
RUN echo '. ~/.nomad-start.sh' >> /home/agent/.bashrc
