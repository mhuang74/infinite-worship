# Analysis Worker Lambda — container image (ADR-0001/0004).
# Built by GitHub Actions on merge to main and pushed to ECR (ADR-0004);
# see infra/worker.tf for the Lambda wiring (reserved concurrency 2).
#
# GOTCHA (bit us during the #18 port): madmom's git HEAD declares
# scipy>=1.13/numpy 2.x, which breaks the pinned numpy==1.24.3/scipy==1.11.3
# stack librosa 0.10.1 needs. Install madmom with --no-deps and keep the pins.
FROM public.ecr.aws/lambda/python:3.11

# ffmpeg (static build, no distro bloat) for librosa/madmom audio decoding.
# libsndfile: librosa.load goes through soundfile, which ctypes-dlopens
# libsndfile.so — without it every analysis dies at import time with
# "cannot load library 'libsndfile.so'" (ffmpeg does NOT cover this).
# The Lambda base image is Amazon Linux 2 — yum, not dnf (dnf: command not found).
# Tarball layout: ffmpeg-<ver>-amd64-static/{ffmpeg,ffprobe} — both globs
# must match `ffmpeg-*-static` (the old `ffmpeg-*--static` never matched ffprobe).
# git: pip needs it to clone madmom from GitHub (requirements.txt + Dockerfile
# both install madmom @ git+...). gcc: madmom's Cython extensions compile at
# install time.
RUN yum install -y tar xz git gcc libsndfile && \
    curl -fsSL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
    | tar -xJ -C /tmp && \
    mv /tmp/ffmpeg-*-static/ffmpeg /usr/local/bin/ffmpeg && \
    mv /tmp/ffmpeg-*-static/ffprobe /usr/local/bin/ffprobe && \
    rm -rf /tmp/ffmpeg-*-static && \
    yum clean all

COPY requirements.txt ${LAMBDA_TASK_ROOT}/

# numba (via librosa) writes JIT cache files NEXT to the cached .py in
# site-packages __pycache__ — read-only under Lambda's /var/task + /var/lang.
# Without this every analysis dies at librosa.load with
# "cannot cache function '__o_fold': no locator available" (RuntimeError from
# numba's cache locator). /tmp is the only writable dir in Lambda.
ENV NUMBA_CACHE_DIR=/tmp/numba_cache

RUN pip install --no-cache-dir \
      numpy==1.24.3 scipy==1.11.3 \
      boto3 "psycopg[binary]" && \
    # setuptools<81: librosa 0.10.1 still imports pkg_resources (removed in 81)
    pip install --no-cache-dir "setuptools<81" && \
    # Cython is madmom's build dep; --no-build-isolation keeps its build from
    # pulling numpy>2 sources (needs a full toolchain AND would ABI-mismatch
    # the pinned numpy 1.24.3 runtime). madmom lives ONLY here — it is
    # deliberately absent from requirements.txt so pip never rebuilds it
    # inside an isolated env (that rebuild pulls numpy>2 sources and fails).
    pip install --no-cache-dir "cython<3" && \
    pip install --no-cache-dir --no-deps --no-build-isolation \
      madmom@git+https://github.com/CPJKU/madmom && \
    pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

COPY handler.py ${LAMBDA_TASK_ROOT}/
COPY reaper.py ${LAMBDA_TASK_ROOT}/
COPY jukebox/ ${LAMBDA_TASK_ROOT}/jukebox/

CMD ["handler.lambda_handler"]
