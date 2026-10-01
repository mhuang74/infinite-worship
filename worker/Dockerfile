# Analysis Worker Lambda — container image (ADR-0001/0004).
# Built by GitHub Actions on merge to main and pushed to ECR (ADR-0004);
# see infra/worker.tf for the Lambda wiring (reserved concurrency 2).
#
# GOTCHA (bit us during the #18 port): madmom's git HEAD declares
# scipy>=1.13/numpy 2.x, which breaks the pinned numpy==1.24.3/scipy==1.11.3
# stack librosa 0.10.1 needs. Install madmom with --no-deps and keep the pins.
FROM public.ecr.aws/lambda/python:3.11

# ffmpeg (static build, no distro bloat) for librosa/madmom audio decoding.
RUN dnf install -y tar xz && \
    curl -fsSL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
    | tar -xJ -C /tmp && \
    mv /tmp/ffmpeg-*-static/ffmpeg /usr/local/bin/ffmpeg && \
    mv /tmp/ffmpeg-*--static/ffprobe /usr/local/bin/ffprobe && \
    rm -rf /tmp/ffmpeg-*-static && \
    dnf clean all

COPY requirements.txt ${LAMBDA_TASK_ROOT}/

RUN pip install --no-cache-dir \
      numpy==1.24.3 scipy==1.11.3 \
      boto3 "psycopg[binary]" && \
    # setuptools<81: librosa 0.10.1 still imports pkg_resources (removed in 81)
    pip install --no-cache-dir "setuptools<81" && \
    pip install --no-cache-dir --no-deps madmom@git+https://github.com/CPJKU/madmom && \
    pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

COPY handler.py ${LAMBDA_TASK_ROOT}/
COPY jukebox/ ${LAMBDA_TASK_ROOT}/jukebox/

CMD ["handler.lambda_handler"]
