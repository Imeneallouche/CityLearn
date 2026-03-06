import warnings
from pathlib import Path

from citylearn.wrappers import (
    ClippedObservationWrapper,
    NormalizedObservationWrapper,
    RLlibMultiAgentEnv,
)

# FIX 1: Use PPOConfig for MAPPO — NOT SACConfig
from ray.rllib.algorithms.ppo import PPOConfig as Config
from ray.rllib.policy.policy import PolicySpec

warnings.filterwarnings('ignore', category=DeprecationWarning)

# ─────────────────────────────────────────
# OUTPUT DIRECTORY
# ─────────────────────────────────────────
output_dir = Path(r'D:\AI Projects\rl-city-learn\outputs\ui_exports')
output_dir.mkdir(parents=True, exist_ok=True)


import io
import zipfile
import requests
from pathlib import Path

CITYLEARN_VERSION  = "v2.5.0"
DATASET_NAME       = "citylearn_challenge_2022_phase_all"
CACHE_DIR          = (
    Path.home()
    / "AppData" / "Local"
    / "intelligent-environments-lab" / "citylearn"
    / "Cache" / CITYLEARN_VERSION / "datasets"
    / DATASET_NAME
)
schema_path = CACHE_DIR / "schema.json"

if schema_path.exists():
    print(f"✅ Dataset already cached at: {schema_path}")
else:
    print("Downloading CityLearn dataset via ZIP archive (no API rate limit)...")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # Single HTTP request to the archive download endpoint — not the GitHub API
    zip_url = (
        f"https://github.com/intelligent-environments-lab/CityLearn"
        f"/archive/refs/tags/{CITYLEARN_VERSION}.zip"
    )
    response = requests.get(zip_url, stream=True, timeout=120)
    response.raise_for_status()

    # Extract only the dataset subfolder directly into the cache directory
    dataset_prefix = (
        f"CityLearn-{CITYLEARN_VERSION.lstrip('v')}"
        f"/data/datasets/{DATASET_NAME}/"
    )
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        matched = [n for n in zf.namelist() if n.startswith(dataset_prefix)]
        if not matched:
            raise FileNotFoundError(
                f"Dataset folder '{dataset_prefix}' not found in ZIP. "
                f"Check CITYLEARN_VERSION and DATASET_NAME."
            )
        for member in matched:
            # Strip the long zip prefix so files land directly in CACHE_DIR
            relative = member[len(dataset_prefix):]
            if not relative:          # skip the folder entry itself
                continue
            dest = CACHE_DIR / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(member) as src, open(dest, "wb") as dst:
                dst.write(src.read())

    print(f"✅ Dataset extracted to: {CACHE_DIR}")

print(f"   schema_path = {schema_path}")

env_config = {
    'env_kwargs': {
        'schema': schema_path,  # FIX 15: local path → no GitHub API call per worker
    },
    'wrappers': [
        NormalizedObservationWrapper,   # min-max normalise + cyclical cosine encoding
        ClippedObservationWrapper,      # REQUIRED for RLlib — prevents ValueError on OOB obs
    ],
}


from ray.rllib.algorithms.callbacks import DefaultCallbacks

class ProgressCallback(DefaultCallbacks):
    def on_episode_step(self, *, worker, base_env, episode, **kwargs):
        total = episode.length
        if total % 50 == 0:
            print(f"  ... sampling step {total}", flush=True)

    def on_train_result(self, *, algorithm, result, **kwargs):
        rw   = result.get("episode_reward_mean", "N/A")
        eps  = result.get("episodes_this_iter", 0)
        ts   = result.get("timesteps_total", 0)
        itr  = result.get("training_iteration", "?")
        rw_s = f"{rw:.4f}" if isinstance(rw, float) else str(rw)
        print(f"[Train] Iter {itr:05} | eps={eps} | mean_reward={rw_s} | total_steps={ts}", flush=True)


#
# MAPPO design:
#   • CTDE (Centralized Training, Decentralized Execution)
#   • All 17 agents share ONE policy network (parameter sharing)
#   • Separate value network per shared policy (vf_share_layers=False)
#   • Each agent receives its own LOCAL observation at execution time
#   • The shared critic implicitly sees all agents' data during training
#     because all transitions are collected into the same policy's batch
# ─────────────────────────────────────────────────────────────────────────────
config = (
    Config()

    # Plug in the live progress callback
    .callbacks(ProgressCallback)

    # FIX: Use the old RLlib API stack for compatibility with RLlibMultiAgentEnv
    .api_stack(
        enable_rl_module_and_learner=False,
        enable_env_runner_and_connector_v2=False,
    )

    # FIX 2: Point to the 17-building schema
    .resources(num_gpus=1) 
    .environment(RLlibMultiAgentEnv, env_config=env_config)

    # FIX 5 & 6: MAPPO shared policy with corrected mapping signature
    .multi_agent(
        policies={"shared_policy": PolicySpec()},
        # FIX 6: explicit (agent_id, episode, worker) signature for old API stack
        policy_mapping_fn=lambda agent_id, episode, worker, **kwargs: "shared_policy",
    )

    # FIX 4 & 5: PPO training config — replay buffer removed, MAPPO hyperparams added
    .training(
        # ── Optimiser ──────────────────────────────────────────────────────
        lr=3e-4,             
        gamma=0.99,          
        lambda_=0.95,        
        clip_param=0.2,         
        vf_loss_coeff=0.5,      
        vf_clip_param=10.0,     
        entropy_coeff=0.01,     
        # ── Batch & SGD ────────────────────────────────────────────────────
        train_batch_size=256,   # Tiny batch → first result in ~30s instead of 8min
        minibatch_size=64,     
        num_epochs=10,          
        # ── MAPPO critic settings ───────────────────────────────────────────
        use_critic=True,        # Enable value function (mandatory for MAPPO)
        use_gae=True,           # Use Generalized Advantage Estimation
        model={
            "fcnet_hiddens": [256, 256],   # Wider than default [64,64]
            "fcnet_activation": "relu",
            "vf_share_layers": False,
        },
    )

    # num_env_runners=0 → sampling runs in the DRIVER process (no remote workers).
    # you can increase num_env_runners back to 2 or 4.
    .env_runners(
        num_env_runners=0,                # 0 = driver process only, no remote workers
        rollout_fragment_length="auto",
        batch_mode="truncate_episodes",
        sample_timeout_s=600,
    )

    .framework("torch")
)

model = config.build()

# ─────────────────────────────────────────
# 3. TRAINING LOOP
# ─────────────────────────────────────────
N_ITERATIONS = 100_000
EVAL_INTERVAL = 1_000

for i in range(N_ITERATIONS):
    result = model.train()
    # on_train_result callback above handles printing — nothing needed here

    # ─────────────────────────────────────
    # Evaluation + CityLearn UI Export
    # ─────────────────────────────────────
    if result.get("training_iteration", i) % EVAL_INTERVAL == 0:

        # Separate eval env_config with render_mode='end' for UI export
        eval_env_config = {
            'env_kwargs': {
                'schema': schema_path,     # FIX 15: local path — no GitHub call
                'render_mode': 'end',          # buffer all steps, write at end
                'render_directory': output_dir,
                'render_session_name': f'eval_ep{i:05d}',
            },
            'wrappers': [
                NormalizedObservationWrapper,
                ClippedObservationWrapper,
            ],
        }

        eval_env = RLlibMultiAgentEnv(eval_env_config)

        # FIX 11: Use consistent variable name 'observations'
        observations, _ = eval_env.reset()

        # FIX 8: Removed unused `done` dict — use eval_env.terminated directly
        while not eval_env.terminated:
            actions = {
                agent_id: model.compute_single_action(
                    obs, policy_id="shared_policy", explore=False
                )
                for agent_id, obs in observations.items()
            }
            # FIX 11: 5-tuple unpack matches gymnasium step() → (obs, rew, term, trunc, info)
            observations, _, _, _, _ = eval_env.step(actions)

        # render_mode='end' triggers automatic write of SimulationData folder here
        print(f"  ✅ Exported CityLearn UI data → {output_dir / f'eval_ep{i:05d}'}")

# ─────────────────────────────────────────────────────────────────────────────
# 4. FINAL KPI SUMMARY
# ─────────────────────────────────────────────────────────────────────────────
kpis = eval_env.unwrapped.evaluate()
kpis = (
    kpis
    .pivot(index='cost_function', columns='name', values='value')
    .round(3)
    .dropna(how='all')   # FIX 10
)
print("\n=== Final KPI Summary ===")
print(kpis)