"""TF-IDF + cosine-distance agglomerative clustering with auto-generated labels."""
import logging
from typing import Optional

import numpy as np
from sklearn.cluster import AgglomerativeClustering
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

import config

log = logging.getLogger("cluster")

EXTRA_STOP_WORDS = {
    "said", "says", "say", "news", "video", "live", "watch", "photos", "updates", "update",
    "report", "reports", "reported", "bbc", "npr", "reuters", "guardian", "jazeera",
    "just", "today", "people", "also", "according", "mr", "mrs", "ms", "read", "https", "www", "com",
}
STOP_WORDS = sorted(w for w in (set(ENGLISH_STOP_WORDS) | EXTRA_STOP_WORDS) if len(w) >= 2)


def article_text(article: dict) -> str:
    """Headline is repeated to weigh it above the (noisier) summary/body."""
    body = (article.get("body") or "")[: config.BODY_CHARS_FOR_CLUSTERING]
    title = article["title"]
    return f"{title}. {title}. {article.get('summary') or ''} {body}"


def _vectorize(texts: list):
    n = len(texts)
    for max_df in ((0.6, 1.0) if n >= 10 else (1.0,)):
        try:
            vectorizer = TfidfVectorizer(
                stop_words=STOP_WORDS,
                token_pattern=r"(?u)\b[a-zA-Z]{2,}\b",
                ngram_range=(1, 2),
                sublinear_tf=True,
                strip_accents="unicode",
                lowercase=True,
                min_df=1,
                max_df=max_df,
            )
            return vectorizer, vectorizer.fit_transform(texts)
        except ValueError:
            continue
    return None, None


def make_label(matrix, feature_names, idxs: list, fallback: str, top_k: int = 3) -> str:
    """Top TF-IDF terms of the cluster centroid, skipping terms that overlap already-chosen ones."""
    centroid = np.asarray(matrix[idxs].mean(axis=0)).ravel()
    chosen: list = []
    used: set = set()
    for j in centroid.argsort()[::-1]:
        if centroid[j] <= 0:
            break
        term = feature_names[j]
        tokens = set(term.split())
        if tokens & used:
            continue
        chosen.append(term)
        used |= tokens
        if len(chosen) == top_k:
            break
    label = " · ".join(t.title() for t in chosen)
    return (label or fallback)[:80]


def cluster_articles(articles: list) -> list:
    """Returns [{'label': str, 'article_ids': [int, ...]}] for clusters with >= MIN_CLUSTER_SIZE articles."""
    if len(articles) < 2:
        return []
    vectorizer, matrix = _vectorize([article_text(a) for a in articles])
    if matrix is None:
        return []

    distance = np.clip(1.0 - cosine_similarity(matrix), 0.0, 1.0)
    np.fill_diagonal(distance, 0.0)
    model = AgglomerativeClustering(
        n_clusters=None,
        metric="precomputed",
        linkage="average",
        distance_threshold=config.CLUSTER_DISTANCE_THRESHOLD,
    )
    assignments = model.fit_predict(distance)

    groups: dict = {}
    for index, cluster_no in enumerate(assignments):
        groups.setdefault(int(cluster_no), []).append(index)

    feature_names = vectorizer.get_feature_names_out()
    result: list = []
    for idxs in groups.values():
        if len(idxs) < config.MIN_CLUSTER_SIZE:
            continue
        label = make_label(matrix, feature_names, idxs, fallback=articles[idxs[0]]["title"])
        result.append({"label": label, "article_ids": [articles[i]["id"] for i in idxs]})
    result.sort(key=lambda c: len(c["article_ids"]), reverse=True)
    return result