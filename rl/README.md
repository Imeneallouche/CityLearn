# Env Setup

- `conda create -n degourdi python 3.11`
- `conda activate degourdi`
- `uv pip install -r requirements.txt`
- `uv pip install torch --index-url https://download.pytorch.org/whl/cu124`

# Visualization of the CityLearn Challenge

- Each `EVAL_INTERVAL`, the performance of the agents is evaluated and logged in `/outputs/ui_exports/`, many metrics are logged, such as the total reward, the energy consumption, the comfort violation, etc.
- The logs are then visualized in a dashboard and can be also compared, which can be accessed at
https://citylearnui.netlify.app/admin/rec-dashboard