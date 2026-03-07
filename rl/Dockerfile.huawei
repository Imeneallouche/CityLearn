FROM pytorch/pytorch:2.10.0-cuda12.8-cudnn9-runtime

# Install conda (miniconda) on top of the PyTorch base
RUN apt-get update && apt-get install -y wget && \
    wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O miniconda.sh && \
    bash miniconda.sh -b -p /opt/conda && \
    rm miniconda.sh && \
    apt-get clean

ENV PATH="/opt/conda/bin:$PATH"

COPY environment.yml .

RUN conda env create -f environment.yml

SHELL ["conda", "run", "-n", "degourdi", "/bin/bash", "-c"]
RUN echo "conda activate degourdi" >> ~/.bashrc

ENTRYPOINT ["conda", "run", "--no-capture-output", "-n", "degourdi"]
CMD ["/bin/bash"]