"""
voting.py

Combines the per-image counts within one set of 3 photos into a
single voted count for that set.
"""

from typing import List


def rounded_mean_vote(counts: List[int]) -> int:
    """
    Returns the mean of the given counts, rounded to the nearest
    integer. E.g. [14, 15, 14] -> 14, [14, 15, 16] -> 15.
    """
    if not counts:
        return 0
    return round(sum(counts) / len(counts))
