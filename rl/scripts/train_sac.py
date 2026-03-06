import warnings
from pathlib import Path
from citylearn.wrappers import ClippedObservationWrapper, NormalizedObservationWrapper, RLlibMultiAgentEnv
from ray.rllib.algorithms.sac import SACConfig as Config
from ray.rllib.policy.policy import PolicySpec

warnings.filterwarnings('ignore', category=DeprecationWarning)


output_dir = Path(__file__).parent / 'outputs_mappo' / 'ui_exports'
output_dir.mkdir(parents=True, exist_ok=True)

# ========================
# 1. ENVIRONMENT CONFIG
# ========================
env_config = {
    'env_kwargs': {
        'schema': 'citylearn_challenge_2023_phase_2_local_evaluation',
        # Add optional rendering parameters for later evaluations
        'render_mode': 'none',  # default off for training
        'render_directory': output_dir,
    },
    'wrappers': [
        NormalizedObservationWrapper,
        ClippedObservationWrapper
    ]
}

# ========================
# 2. RLlib CONFIG
# ========================
config = (
    Config()
    # Use the old RLlib API stack for compatibility with RLlibMultiAgentEnv
    .api_stack(enable_rl_module_and_learner=False, enable_env_runner_and_connector_v2=False)
    # Recommended replay buffer when using old API stack with SAC
    .training(
        replay_buffer_config={
            "type": "MultiAgentPrioritizedReplayBuffer",
            "capacity": 1_000_000,
            "prioritized_replay_alpha": 0.6,
            "prioritized_replay_beta": 0.4,
            "prioritized_replay_eps": 1e-6,
        }
    )
    .resources(num_gpus=1) 
    .environment(RLlibMultiAgentEnv, env_config=env_config)
    .multi_agent(
        # Single shared policy for all agents
        policies={"shared_policy": PolicySpec()},
        policy_mapping_fn=lambda agent_id, *args, **kwargs: "shared_policy",
    )
    .framework("torch")
)

model = config.build()

# ========================
# 3. TRAINING LOOP
# ========================
N_EPISODES = 100000
EVAL_INTERVAL = 1000

for i in range(N_EPISODES):
    result = model.train()
    # In the old RLlib API stack, episode stats live under 'env_runners'.
    env_stats = result.get('env_runners', {})
    mean_reward = env_stats.get('episode_reward_mean', None)
    num_episodes = env_stats.get('num_episodes', None)
    steps_trained = result.get('num_steps_trained_this_iter', None)
    print(f"[Train] Iter {i} | episodes={num_episodes} | mean_reward={mean_reward} | steps_trained={steps_trained}")

    # =====================
    # Evaluation + Export
    # =====================
    if i % EVAL_INTERVAL == 0:
        # Create new environment for evaluation with render_mode='end'
        eval_env_config = {
            'env_kwargs': {
                'schema': 'citylearn_challenge_2023_phase_2_local_evaluation',
                'render_mode': 'end',  # <-- buffered export at end
                'render_directory': output_dir,
                'render_session_name': f"eval_ep{i:04d}",  # folder name
            },
            'wrappers': [
                NormalizedObservationWrapper,
                ClippedObservationWrapper
            ]
        }

        eval_env = RLlibMultiAgentEnv(eval_env_config)
        obs, _ = eval_env.reset()
        done = {a: False for a in obs}

        while not eval_env.terminated:
            actions = {
                a: model.compute_single_action(o, policy_id="shared_policy", explore=False)
                for a, o in obs.items()
            }
            obs, _, _, _, _ = eval_env.step(actions)

        # Automatically writes SimulationData folder
        print(f"[Exported CityLearn UI data]  eval_ep{i:04d} to outputs/ui_exports/")

# ========================
# 4. (Optional) KPI Summary
# ========================
kpis = eval_env.unwrapped.evaluate()
kpis = kpis.pivot(index='cost_function', columns='name', values='value').round(3)
print(kpis)
