from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class ResidualBlock(nn.Module):
    def __init__(self, ch: int = 64) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(ch, ch, kernel_size=3, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(ch)
        self.conv2 = nn.Conv2d(ch, ch, kernel_size=3, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(ch)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        y = F.relu(self.bn1(self.conv1(x)))
        y = self.bn2(self.conv2(y))
        return F.relu(x + y)


class AlphaZeroNet(nn.Module):
    def __init__(
        self,
        h: int,
        w: int,
        action_size: int,
        in_ch: int = 5,
        trunk_ch: int = 64,
        blocks: int = 6,
        latent_dim: int = 128,
        atlas_dim: int = 8,
    ) -> None:
        super().__init__()
        self.h = h
        self.w = w
        self.action_size = action_size
        self.latent_dim = latent_dim

        self.stem = nn.Sequential(
            nn.Conv2d(in_ch, trunk_ch, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(trunk_ch),
            nn.ReLU(),
        )
        self.res_blocks = nn.Sequential(*[ResidualBlock(trunk_ch) for _ in range(blocks)])

        self.latent_proj = nn.Sequential(
            nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Linear(trunk_ch, latent_dim),
            nn.LayerNorm(latent_dim),
            nn.Tanh(),
        )
        self.policy_head = nn.Sequential(
            nn.Conv2d(trunk_ch, 2, kernel_size=1, bias=False),
            nn.BatchNorm2d(2),
            nn.ReLU(),
            nn.Flatten(),
            nn.Linear(2 * h * w, action_size),
        )
        self.value_head = nn.Sequential(
            nn.Linear(latent_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
            nn.Sigmoid(),
        )
        self.atlas_head = nn.Linear(latent_dim, atlas_dim)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        f = self.res_blocks(self.stem(x))
        latent = self.latent_proj(f)
        policy_logits = self.policy_head(f)
        value = self.value_head(latent).squeeze(-1)
        return policy_logits, value, latent

    def forward_with_atlas(
        self, x: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        policy_logits, value, latent = self.forward(x)
        atlas = self.atlas_head(latent)
        return policy_logits, value, latent, atlas

