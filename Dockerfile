FROM node:18

# Set the working directory inside the container
WORKDIR /app

# Copy only package.json and package-lock.json (if available)
COPY govauctionplatform/package*.json ./

# Install the dependencies
RUN npm install

# Copy the rest of the application code
COPY govauctionplatform/ .

# Expose port 8891
EXPOSE 8891

# Command to run the application
CMD ["npm", "run", "start:dev"]