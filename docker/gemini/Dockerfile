FROM docker/sandbox-templates:gemini

USER root
COPY shared/install-planrla.sh /tmp/install-planrla.sh
RUN chmod +x /tmp/install-planrla.sh && /tmp/install-planrla.sh

USER agent
RUN npm install -g planrla && planrla --version

COPY --chown=agent:agent shared/start-planrla.sh /home/agent/.planrla-start.sh
RUN echo '. ~/.planrla-start.sh' >> /home/agent/.bashrc
