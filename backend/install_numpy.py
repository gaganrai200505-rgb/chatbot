import sys
import subprocess
print("Installing down-graded numpy...")
subprocess.run([sys.executable, "-m", "pip", "install", "numpy==1.26.4", "--force-reinstall", "--no-cache-dir"], check=True)
print("Finished!")
